import copy from '../content/emulator.json';
import type {EmulatorWorkerBridge, EmulatorWorkerRpcError, EmulatorWorkerSnapshot} from '../lib/emulator/worker-rpc';
type State='empty'|'ready'|'loading'|'paused'|'running'|'halted'|'fault';
type Command='run'|'pause'|'reset'|'step'|'usb'|'input'|'trace';
const limits=copy.traceLimits;
const labels:Record<State,string>=copy.stateLabels;
const maxSessions=4;
const maxFileBytes=4*1024*1024;
const sdUnitBytes=256*1024;
const maxSdBytes=128*1024*1024;
const hex=(value:number)=>`0x${(value>>>0).toString(16).padStart(8,'0').toUpperCase()}`;
const reportHex=(bytes:number[])=>bytes.map(value=>(value&255).toString(16).padStart(2,'0').toUpperCase()).join(' ');

class BrowserSession{
  private bridge?:EmulatorWorkerBridge;
  private unsubscribe?:()=>void;
  private image?:ArrayBuffer;
  private cards:{bytes:ArrayBuffer;name:string}[]=[];
  private cardRevisions=[0,0];
  private cardReads=new Set<number>();
  private cardVersion=0;
  private loadedCardVersion=0;
  private pendingBridge?:EmulatorWorkerBridge;
  private preparing=false;
  private loadRevision=0;
  private name='';
  private sourceHash?:string;
  private state:State='empty';
  private loaded=false;
  private revision=0;
  private generation=0;
  private traceRevision=0;
  private busy=false;
  private pendingControls=0;
  private importWatch?:ReturnType<typeof setTimeout>;
  private runWatch?:ReturnType<typeof setTimeout>;
  private failure?:{command:string;at:string;message:string};
  private snapshot:Partial<EmulatorWorkerSnapshot>={};
  private exchanges:{direction:string;report:number[]}[]=[];
  private commands:{id:number;command:string;details?:object}[]=[];
  private commandCount=0;
  private heldPads=new Set<HTMLButtonElement>();
  private events=new AbortController();
  constructor(readonly element:HTMLElement,readonly remove:()=>void){
    const options={signal:this.events.signal};
    this.find<HTMLInputElement>('[data-file]').disabled=false;
    this.find<HTMLSelectElement>('[data-format]').disabled=false;
    this.find<HTMLTextAreaElement>('[data-usb-report]').value=reportHex([4,1,...Array(62).fill(0)]);
    element.addEventListener('change',event=>{
      const target=event.target as HTMLElement;
      if(target.matches('[data-file]'))void this.readFile();
      if(target.matches('[data-sd-file]'))void this.readCard(Number(target.dataset.sdFile)-1);
      if(target.matches('[data-format]')){this.stopWorker();this.state=this.image?'ready':'empty';this.clearError();this.render();}
      if(target.matches('[data-input-control]'))this.find<HTMLElement>('[data-input-note]').hidden=this.find<HTMLSelectElement>('[data-input-control]').value!=='VALUE TURN';
    },options);
    this.find<HTMLInputElement>('[data-session-name]').addEventListener('input',()=>element.setAttribute('aria-label',this.sessionName()),options);
    element.addEventListener('click',event=>{
      const card=(event.target as Element).closest<HTMLButtonElement>('[data-sd-remove]');
      if(card){this.removeCard(Number(card.dataset.sdRemove)-1);return;}
      const action=(event.target as Element).closest<HTMLButtonElement>('[data-action]')?.dataset.action;
      if(action==='remove'){this.close();this.remove();}
      if(action==='start')void this.start();
      if(action==='reset'&&!this.loaded){this.stopWorker();this.state=this.image?'ready':'empty';this.clearError();this.render();return;}
      if(action==='pause'||action==='reset'||action==='step'){this.clearError();this.send(action,action==='step'?{instructions:1}:undefined);}
      if(action==='usb-status'){this.clearError();this.find<HTMLElement>('[data-usb-result]').textContent='Waiting for the virtual endpoint…';this.send('usb');}
      if(action==='power-off'){this.clearError();this.send('input',{input:{power:false}});}
      if(action==='export'){
        if(this.failure)this.download({schema:'opensp-emulator-unresponsive-worker-v1',failure:this.failure,lastPublishedSnapshot:this.snapshot,limitation:'The worker did not answer. This is the last published snapshot, not a completed final engine trace.'});
        else{this.clearError();this.send('trace');}
      }
    },options);
    this.find<HTMLFormElement>('[data-usb-form]').addEventListener('submit',event=>{event.preventDefault();this.usb();},options);
    this.find<HTMLInputElement>('[data-input-value]').addEventListener('input',()=>{this.find<HTMLOutputElement>('[data-input-level]').value=Number(this.find<HTMLInputElement>('[data-input-value]').value).toFixed(2);},options);
    this.find<HTMLFormElement>('[data-input-form]').addEventListener('submit',event=>{
      event.preventDefault();if(!this.loaded)return;
      const control=this.find<HTMLSelectElement>('[data-input-control]').value;
      const value=Number(this.find<HTMLInputElement>('[data-input-value]').value);
      this.clearError();this.send('input',{input:{control,value}});
      this.find<HTMLElement>('[data-input-result]').textContent=`${control} set to ${value.toFixed(2)}.`;
    },options);
    this.element.querySelectorAll<HTMLButtonElement>('[data-pad-control]').forEach(button=>{
      button.addEventListener('pointerdown',event=>{if(event.button!==0||button.disabled)return;event.preventDefault();button.focus();button.setPointerCapture(event.pointerId);this.pad(button,true);},options);
      for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>this.pad(button,false),options);
      button.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();if(!event.repeat)this.pad(button,true);}},options);
      button.addEventListener('keyup',event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();this.pad(button,false);}},options);
      button.addEventListener('blur',()=>this.pad(button,false),options);
    });
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.releasePads();},options);
    this.render();this.paint(Array(1024).fill(0));
  }
  private find<T extends Element>(selector:string){return this.element.querySelector<T>(selector)!;}
  private sessionName(){return this.find<HTMLInputElement>('[data-session-name]').value.trim()||'Unnamed session';}
  private pad(button:HTMLButtonElement,down:boolean){
    if(down&&(!this.loaded||button.disabled)||this.heldPads.has(button)===down)return;
    if(down)this.heldPads.add(button);else this.heldPads.delete(button);
    button.setAttribute('aria-pressed',String(down));
    const control=button.dataset.padControl!;
    this.element.querySelector(`[data-part="${control.replace('PAD','Pad')}"]`)?.classList.toggle('input-active',down);
    this.send('input',{input:{control,value:down?1:0}});
  }
  private releasePads(){for(const button of this.heldPads)this.pad(button,false);}
  private clearError(){const error=this.find<HTMLElement>('[data-session-error]');error.hidden=true;error.textContent='';}
  private error(message:string){const error=this.find<HTMLElement>('[data-session-error]');error.textContent=message;error.hidden=false;}
  private cardError(slot:number,message=''){
    const error=this.find<HTMLElement>(`[data-sd-error="${slot+1}"]`);error.textContent=message;error.hidden=!message;
  }
  private async readCard(slot:number){
    if(slot!==0&&slot!==1||this.busy||this.state==='running')return;
    const input=this.find<HTMLInputElement>(`[data-sd-file="${slot+1}"]`),file=input.files?.[0];
    if(!file)return;
    const revision=++this.cardRevisions[slot];this.cardError(slot);
    if(!Number.isSafeInteger(file.size)||file.size<sdUnitBytes||file.size>maxSdBytes||file.size%sdUnitBytes){
      this.cardReads.delete(slot);input.value='';this.cardError(slot,copy.sdSizeError);this.render();return;
    }
    this.cardReads.add(slot);this.render();
    try{
      const bytes=await file.arrayBuffer();
      if(revision!==this.cardRevisions[slot]||!this.element.isConnected)return;
      if(!(bytes instanceof ArrayBuffer)||bytes.byteLength!==file.size)throw new Error('Invalid card read');
      this.cards[slot]={bytes:new Uint8Array(bytes).slice().buffer,name:file.name};++this.cardVersion;
    }catch{
      if(revision===this.cardRevisions[slot]&&this.element.isConnected){input.value='';this.cardError(slot,copy.sdReadError);}
    }finally{
      if(revision===this.cardRevisions[slot]){this.cardReads.delete(slot);this.render();}
    }
  }
  private removeCard(slot:number){
    if(slot!==0&&slot!==1||this.busy||this.state==='running')return;
    ++this.cardRevisions[slot];this.cardReads.delete(slot);
    if(this.cards[slot]){delete this.cards[slot];++this.cardVersion;}
    this.find<HTMLInputElement>(`[data-sd-file="${slot+1}"]`).value='';this.cardError(slot);this.render();
  }
  private cardChanges(){return this.loaded&&this.cardVersion!==this.loadedCardVersion;}
  private async readFile(){
    if(this.preparing&&this.loaded)return;
    const file=this.find<HTMLInputElement>('[data-file]').files?.[0];
    const revision=++this.revision;
    this.stopWorker();this.image=undefined;this.name='';this.state='empty';this.clearError();
    this.find<HTMLElement>('[data-firmware-name]').textContent=copy.noFile;this.render();
    if(!file)return;
    if(!file.size||file.size>maxFileBytes){this.error('Choose a non-empty firmware file up to 4 MiB.');return;}
    try{
      const image=await file.arrayBuffer();
      if(revision!==this.revision||!this.element.isConnected)return;
      this.image=image;this.name=file.name;this.state='ready';
      this.find<HTMLElement>('[data-firmware-name]').textContent=`${file.name} · ${file.size.toLocaleString()} bytes`;
    }catch{if(revision===this.revision)this.error('The firmware file could not be read. Select it again.');}
    this.render();
  }
  private async start(){
    if(!this.image||this.busy||this.cardReads.size||this.state==='running')return;
    this.clearError();
    if(this.bridge&&this.loaded&&!this.cardChanges()){this.send('run');return;}
    const previous=this.bridge,previousState=this.state,retained=!!previous&&this.loaded;
    this.state='loading';this.busy=true;this.preparing=true;this.render();
    const generation=this.generation,image=this.image,loadRevision=++this.loadRevision,cardVersion=this.cardVersion;
    const cards={sd1:this.cards[0]?.bytes,sd2:this.cards[1]?.bytes};
    this.importWatch=setTimeout(()=>{
      if(generation!==this.generation||loadRevision!==this.loadRevision||this.pendingBridge)return;
      if(retained){++this.loadRevision;this.clearWatches();this.busy=false;this.preparing=false;this.state=previousState;this.error('The runtime could not be loaded. The current session is unchanged. Try Apply cards again.');this.render();}
      else this.failWorker('load','Emulator worker stopped responding during runtime loading. This session was stopped. Reset it or select the file again to retry.');
    },45000);
    let bridge:EmulatorWorkerBridge|undefined;
    let committed=false;
    let provisionalUnsubscribe:(()=>void)|undefined;
    const candidateCommands:{id:number;command:string;details?:object}[]=[];
    try{
      const {createBrowserWorkerBridge}=await import('../lib/emulator/worker-rpc');
      if(generation!==this.generation||loadRevision!==this.loadRevision||image!==this.image||!this.element.isConnected)return;
      clearTimeout(this.importWatch);this.importWatch=undefined;
      bridge=createBrowserWorkerBridge();this.pendingBridge=bridge;
      provisionalUnsubscribe=bridge.subscribe(event=>{if(event.type==='request')candidateCommands.push({id:event.id,command:event.command,details:event.details});});
      const snapshot=await bridge.load(image,{format:this.find<HTMLSelectElement>('[data-format]').value as 'app1'|'flash',name:this.name,...cards});
      if(generation!==this.generation||loadRevision!==this.loadRevision||this.pendingBridge!==bridge||!this.element.isConnected)return;
      if(snapshot.state==='fault'||snapshot.fault)throw new Error('The new session stopped during load.');
      provisionalUnsubscribe();provisionalUnsubscribe=undefined;this.pendingBridge=undefined;
      this.stopWorker();this.bridge=bridge;committed=true;this.busy=true;this.state='loading';this.loadedCardVersion=cardVersion;
      for(const row of candidateCommands)this.record(row.id,row.command,row.details);
      const owned=bridge;
      const ownedGeneration=this.generation;
      this.unsubscribe=bridge.subscribe(event=>{
        if(this.bridge!==owned||ownedGeneration!==this.generation)return;
        if(event.type==='request')this.record(event.id,event.command,event.details);
        if(event.type==='snapshot')this.receive(event.snapshot);
        if(event.type==='terminal')this.bridgeError(event.error,owned);
      });
      this.loaded=true;this.sourceHash=snapshot.firmwareHash;
      this.receive(snapshot);
      await bridge.run();
    }catch(error){
      if(committed){if(this.bridge===bridge)this.bridgeError(error,bridge!);}
      else if(generation===this.generation&&loadRevision===this.loadRevision){
        if(!retained&&bridge?.closed){
          for(const row of candidateCommands)this.record(row.id,row.command,row.details);
          this.snapshot=bridge.latestDiagnostics??this.snapshot;
          const rpc=error as Partial<EmulatorWorkerRpcError>,command=rpc.command??'load';
          this.failWorker(command,rpc.code==='timeout'?`Emulator worker stopped responding during ${command==='load'?'runtime loading':command}. This session was stopped. Reset it or select the file again to retry.`:error instanceof Error?error.message:String(error));
        }else{
          this.preparing=false;this.state=retained?previousState:'fault';
          this.error(retained?'The new session could not be loaded. The current session is unchanged. Try Apply cards again.':error instanceof Error?error.message:String(error));
        }
      }
    }finally{
      provisionalUnsubscribe?.();
      if(!committed){bridge?.close();if(this.pendingBridge===bridge)this.pendingBridge=undefined;}
      if(committed?this.bridge===bridge:generation===this.generation&&loadRevision===this.loadRevision){this.preparing=false;this.clearWatches();this.busy=false;this.watchRun();this.render();}
    }
  }
  private send(command:Command,details?:{instructions?:number;report?:number[];input?:Record<string,unknown>}){
    void this.perform(command,details);
  }
  private async perform(command:Command,details?:{instructions?:number;report?:number[];input?:Record<string,unknown>}){
    const bridge=this.bridge,generation=this.generation;
    if(!bridge||!this.loaded)return;
    const traceRevision=command==='trace'?++this.traceRevision:0;
    const blocking=['run','pause','reset','step','usb'].includes(command);
    if(blocking){++this.pendingControls;this.busy=true;this.clearWatches();this.render();}
    try{
      if(command==='run')await bridge.run();
      if(command==='pause')await bridge.pause();
      if(command==='reset')await bridge.restart();
      if(command==='step')await bridge.step(details?.instructions??1);
      if(command==='input')await bridge.input(details?.input??{});
      if(command==='trace'){
        const trace=await bridge.trace();
        if(this.bridge===bridge&&generation===this.generation&&traceRevision===this.traceRevision)this.download(trace);
      }
      if(command==='usb'){
        const report=await bridge.transport(details?.report);
        if(this.bridge!==bridge||generation!==this.generation)return;
        this.exchanges.push({direction:'input',report});this.exchanges=this.exchanges.slice(-128);
        this.find<HTMLElement>('[data-usb-result]').textContent=reportHex(report);
      }
    }catch(error){if(this.bridge===bridge&&generation===this.generation)this.bridgeError(error,bridge);}
    finally{
      if(this.bridge===bridge&&generation===this.generation){
        if(blocking)--this.pendingControls;
        this.busy=this.pendingControls>0;this.watchRun();this.render();
      }
    }
  }
  private clearWatches(){clearTimeout(this.importWatch);this.importWatch=undefined;clearTimeout(this.runWatch);this.runWatch=undefined;}
  private watchRun(){
    clearTimeout(this.runWatch);this.runWatch=undefined;
    const bridge=this.bridge;if(!bridge||this.state!=='running'||this.busy)return;
    this.runWatch=setTimeout(()=>{if(this.bridge===bridge&&this.state==='running')this.failWorker('run','Emulator worker stopped responding while running. This session was stopped. Reset it or select the file again to retry.');},15000);
  }
  private bridgeError(error:unknown,bridge:EmulatorWorkerBridge){
    if(this.bridge!==bridge)return;
    const rpc=error as Partial<EmulatorWorkerRpcError>;
    if(bridge.closed){
      const command=rpc.command??'runtime';
      const message=rpc.code==='timeout'?`Emulator worker stopped responding during ${command==='load'?'runtime loading':command}. This session was stopped. Reset it or select the file again to retry.`:error instanceof Error?error.message:String(error);
      this.failWorker(command,message);return;
    }
    this.error(error instanceof Error?error.message:String(error));
    if(!this.loaded)this.state='fault';
  }
  private failWorker(command:string,message:string){
    this.preparing=false;++this.loadRevision;this.pendingBridge?.close();this.pendingBridge=undefined;
    ++this.generation;this.clearWatches();this.unsubscribe?.();this.unsubscribe=undefined;this.bridge?.close(message);this.bridge=undefined;this.loaded=false;this.pendingControls=0;this.busy=false;this.state='fault';
    for(const button of this.heldPads){button.setAttribute('aria-pressed','false');const control=button.dataset.padControl!;this.element.querySelector(`[data-part="${control.replace('PAD','Pad')}"]`)?.classList.remove('input-active');}
    this.heldPads.clear();this.failure={command,at:new Date().toISOString(),message};this.error(message);this.render();
  }
  private record(id:number,command:string,details?:object){++this.commandCount;this.commands.push({id,command,details});this.commands=this.commands.slice(-256);}
  private receive(reply:EmulatorWorkerSnapshot){
    this.snapshot=reply;
    const state=reply.state==='loaded'?'paused':reply.state;
    if(this.loaded&&!this.preparing&&state in labels)this.state=state as State;
    if(reply.display)this.paint(reply.displayOn===false?Array(1024).fill(0):reply.display);
    if(reply.fault)this.error(reply.fault);
    this.watchRun();
    this.render();
  }
  private usb(){
    if(!this.loaded||this.busy)return;
    const value=this.find<HTMLTextAreaElement>('[data-usb-report]').value.trim();
    if(!value){this.error('Enter a hexadecimal USB report.');return;}
    const pairs=value.split(/\s+/);
    if(pairs.some(pair=>!/^[\da-f]{2}$/i.test(pair))){this.error('Use two hexadecimal digits per byte, separated by spaces.');return;}
    if(pairs.length!==64){this.error(`A USB report requires 64 bytes; this report has ${pairs.length}.`);return;}
    const report=pairs.map(pair=>parseInt(pair,16));
    this.clearError();this.exchanges.push({direction:'output',report});this.exchanges=this.exchanges.slice(-128);
    this.find<HTMLElement>('[data-usb-result]').textContent='Waiting for the virtual endpoint…';
    this.send('usb',{report});
  }
  private paint(bytes:number[]){
    if(bytes.length!==1024)return;
    const context=this.find<HTMLCanvasElement>('[data-oled]').getContext('2d');if(!context)return;
    const image=context.createImageData(128,64);
    for(let y=0;y<64;y++)for(let x=0;x<128;x++){
      const index=(y*128+x)*4;
      const value=bytes[(y>>>3)*128+x]&(1<<(y&7))?255:0;
      image.data[index]=value;image.data[index+1]=value;image.data[index+2]=value;image.data[index+3]=255;
    }
    context.putImageData(image,0,0);
  }
  private render(){
    this.element.dataset.state=this.state;this.element.setAttribute('aria-busy',String(this.busy));
    this.find<HTMLElement>('[data-session-state]').textContent=labels[this.state];
    const enabled=this.loaded&&!this.busy;
    for(const action of ['start','pause','reset','step','export','remove','usb-status','power-off']){
      const button=this.find<HTMLButtonElement>(`[data-action="${action}"]`);
      button.disabled=action==='remove'?false:action==='start'?!this.image||this.busy||this.state==='running'||this.state==='fault':action==='pause'?!enabled||this.state!=='running':action==='step'?!enabled||this.state==='running':action==='reset'&&this.state==='fault'?false:action==='export'&&this.failure?false:!enabled;
      if(action==='start'){
        button.disabled||=this.cardReads.size>0;
        button.textContent=this.state==='loading'?'Loading…':this.state==='running'?'Running':this.cardChanges()?copy.applyCards:this.loaded?'Resume':copy.start;
      }
    }
    this.find<HTMLInputElement>('[data-file]').disabled=this.preparing&&this.loaded;
    this.find<HTMLSelectElement>('[data-format]').disabled=this.busy||this.state==='running';
    for(const slot of [0,1]){
      this.find<HTMLInputElement>(`[data-sd-file="${slot+1}"]`).disabled=this.busy||this.state==='running';
      this.find<HTMLButtonElement>(`[data-sd-remove="${slot+1}"]`).disabled=this.busy||this.state==='running'||!this.cards[slot]&&!this.cardReads.has(slot);
      this.find<HTMLElement>(`[data-sd-name="${slot+1}"]`).textContent=this.cardReads.has(slot)?copy.sdReading:this.cards[slot]?`${this.cards[slot].name} · ${this.cards[slot].bytes.byteLength.toLocaleString()} bytes · read-only`:copy.sdNoImage;
    }
    this.find<HTMLElement>('[data-sd-change]').textContent=this.cardChanges()?copy.sdPendingNote:copy.sdChangeNote;
    this.find<HTMLTextAreaElement>('[data-usb-report]').disabled=!enabled;
    this.find<HTMLButtonElement>('[data-usb-form] button[type="submit"]').disabled=!enabled;
    this.element.querySelectorAll<HTMLInputElement|HTMLButtonElement>('[data-input-form] input,[data-input-form] select,[data-input-form] button,[data-pad-control]').forEach(input=>{input.disabled=!enabled||this.state==='fault';});
    const {pc,instructions,firmwareHash,unknownMmio,unknownMmioOverflow,checkpoint,marker,frames}=this.snapshot;
    this.find<HTMLElement>('[data-diagnostic="pc"]').textContent=pc===undefined?'—':hex(pc);
    this.find<HTMLElement>('[data-diagnostic="instructions"]').textContent=String(instructions??0);
    this.find<HTMLElement>('[data-diagnostic="hash"]').textContent=firmwareHash||'Available after load';
    const tracked=Array.isArray(unknownMmio)?String(unknownMmio.reduce((sum,item)=>sum+(typeof item?.count==='number'?item.count:1),0)):String(unknownMmio??0);
    this.find<HTMLElement>('[data-diagnostic="mmio"]').textContent=unknownMmioOverflow?`${tracked} recorded · ${unknownMmioOverflow} unrecorded`:tracked;
    this.find<HTMLElement>('[data-diagnostic="checkpoint"]').textContent=typeof checkpoint==='string'?checkpoint:checkpoint?JSON.stringify(checkpoint):copy.waiting;
    this.find<HTMLElement>('[data-diagnostic="marker"]').textContent=marker===undefined?'—':hex(marker);
    this.find<HTMLElement>('[data-diagnostic="frames"]').textContent=String(frames??0);
    const coverage=this.find<HTMLElement>('[data-model-limits]');
    const modelLimits=this.snapshot.limitations??[copy.modelInitial];
    if(coverage.textContent!==modelLimits.join(''))coverage.replaceChildren(...modelLimits.map(limit=>{const item=document.createElement('li');item.textContent=limit;return item;}));
    const unknown=Array.isArray(unknownMmio)?unknownMmio:[];
    const accesses=unknown.slice(0,12).map(item=>`${hex(item.address??0)} ${item.operation??'access'} ${item.width??'?'} bytes · ${item.count??1} accesses`);
    if(unknown.length>12)accesses.push(`Another ${unknown.length-12} recorded addresses are in the exported trace.`);
    if(unknownMmioOverflow)accesses.push(`Recording capacity was reached; ${unknownMmioOverflow} additional accesses have no retained detail.`);
    this.find<HTMLElement>('[data-mmio-details]').textContent=accesses.join('\n')||copy.noUnknownMmio;
  }
  private download(trace:unknown){
    const payload={schema:'opensp-emulator-browser-trace-v1',exportedAt:new Date().toISOString(),session:this.sessionName(),sourceFile:{name:this.name,format:this.find<HTMLSelectElement>('[data-format]').value,sha256:this.sourceHash},firmware:{sha256:this.snapshot.firmwareHash},limits,trace,commands:{total:this.commandCount,retained:this.commands},usbExchanges:this.exchanges};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`opensp-${this.sessionName().replace(/[^\w-]/g,'-').slice(0,60)}-trace.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  private stopWorker(){
    this.preparing=false;++this.loadRevision;this.pendingBridge?.close();this.pendingBridge=undefined;
    this.releasePads();++this.generation;this.clearWatches();this.unsubscribe?.();this.unsubscribe=undefined;this.bridge?.close();this.bridge=undefined;this.loaded=false;this.pendingControls=0;this.busy=false;this.sourceHash=undefined;this.failure=undefined;
    this.snapshot={};this.exchanges=[];this.commands=[];this.commandCount=0;this.find<HTMLElement>('[data-usb-result]').textContent=copy.noReport;this.paint(Array(1024).fill(0));
  }
  private cancelCardReads(){this.cardRevisions=this.cardRevisions.map(value=>value+1);this.cardReads.clear();}
  suspend(){++this.revision;this.cancelCardReads();this.stopWorker();this.state=this.image?'ready':'empty';this.render();}
  close(){++this.revision;this.cancelCardReads();this.stopWorker();this.cards=[];this.image=undefined;this.events.abort();}
}

const root=document.querySelector<HTMLElement>('[data-emulator]');
if(root){
  const container=root.querySelector<HTMLElement>('[data-sessions]')!;
  const initial=container.querySelector<HTMLElement>('[data-session]')!;
  const template=initial.cloneNode(true) as HTMLElement;
  const sessions=new Map<HTMLElement,BrowserSession>();
  const add=root.querySelector<HTMLButtonElement>('[data-add-session]')!;
  let count=0;
  const sync=()=>{add.disabled=sessions.size>=maxSessions;root.querySelector<HTMLElement>('[data-session-limit]')!.textContent=sessions.size>=maxSessions?`All ${maxSessions} session slots are in use. Remove a session to add another.`:sessions.size===0?'Add a session to load a firmware file.':'';};
  const attach=(element:HTMLElement)=>{
    ++count;element.setAttribute('aria-label',`Session ${count}`);element.querySelector<HTMLInputElement>('[data-session-name]')!.value=`Session ${count}`;
    element.querySelectorAll<SVGElement>('[id]').forEach(node=>{
      const oldId=node.id,newId=`${oldId}-session-${count}`;node.id=newId;
      element.querySelectorAll<SVGElement>('[clip-path]').forEach(clipped=>{if(clipped.getAttribute('clip-path')===`url(#${oldId})`)clipped.setAttribute('clip-path',`url(#${newId})`);});
    });
    sessions.set(element,new BrowserSession(element,()=>{const previous=element.previousElementSibling,next=element.nextElementSibling;sessions.delete(element);element.remove();sync();((next||previous)?.querySelector('[data-session-name]') as HTMLElement|undefined)?.focus();if(!sessions.size)add.focus();}));sync();
  };
  attach(initial);
  add.addEventListener('click',()=>{if(sessions.size>=maxSessions)return;const element=template.cloneNode(true) as HTMLElement;container.append(element);attach(element);element.querySelector<HTMLInputElement>('[data-session-name]')!.focus();});
  window.addEventListener('pagehide',()=>{for(const session of sessions.values())session.suspend();});
}
