import {createExample,loadSound,setPage,knobPacket,note,valueTurn,valuePress,exitExample,rec,renderExample,sounds,pages,labels,envelopeTimes,slot} from '../lib/synth-examples';

class SynthExamples extends HTMLElement {
  connectedCallback(){
    if(this.dataset.ready)return;this.dataset.ready='true';
    let state=createExample(),phase=0,animate=false,visible=false,frame=0,last=0,volume=96;
    const query=<T extends HTMLElement>(selector:string)=>this.querySelector<T>(selector)!;
    const canvases=[...this.querySelectorAll<HTMLCanvasElement>('[data-synth-screen]')];
    const controls=query<HTMLDivElement>('.synth-example-controls'),sound=query<HTMLSelectElement>('[data-sound]'),page=query<HTMLSelectElement>('[data-page]'),bank=query<HTMLSelectElement>('[data-bank]'),held=query<HTMLInputElement>('[data-held-value]');
    const knobs=[...this.querySelectorAll<HTMLInputElement>('[data-knob]')],pads=[...this.querySelectorAll<HTMLButtonElement>('[data-pad]')];
    const paint=()=>{
      const pixels=renderExample(state,phase),image=new ImageData(128,64);
      pixels.forEach((value,i)=>{const offset=i*4;image.data[offset]=image.data[offset+1]=image.data[offset+2]=value?255:0;image.data[offset+3]=255;});
      for(const canvas of canvases)canvas.getContext('2d')!.putImageData(image,0,0);
    };
    const update=()=>{
      sound.value=String(state.preset);page.value=String(state.page);bank.value=String(state.bank);
      this.querySelectorAll('[data-knob-label]').forEach((label,i)=>{
        label.querySelector('[data-parameter-name]')!.textContent=`CTRL ${i+1}: ${labels[state.page][i]}`;
        label.querySelector('[data-parameter-value]')!.textContent=`Parameter ${Math.round(state.values[state.page*3+i]*100/4095)} / physical ${Math.round(state.physical[i]*100/127)}`;
        knobs[i].setAttribute('aria-valuetext',`Physical ${Math.round(state.physical[i]*100/127)} percent; ${labels[state.page][i]} parameter ${Math.round(state.values[state.page*3+i]*100/4095)}`);
      });
      const blocked=['choose','armed','recording','saving','patterns','logo'].includes(state.screen);
      for(const select of [sound,page])select.disabled=blocked;
      knobs.forEach(knob=>knob.disabled=blocked);
      bank.disabled=!['choose','patterns'].includes(state.screen);
      pads.forEach((pad,i)=>{pad.setAttribute('aria-pressed',String(state.notes.includes(i)));pad.dataset.available=state.screen==='choose'?String(![0,3,8,11].includes(i)):state.screen==='patterns'?String([0,4,9,14].includes(i)):'true';});
      query('[data-feedback]').textContent=state.message;
      const voice=state.mono?'MONO4':'POLY4',parameterText=labels[state.page].map((label,i)=>`${label} ${Math.round(state.values[state.page*3+i]*100/4095)}`).join(', ');
      let summary=`${sounds[state.preset].name}${state.modified?' edited':''}. ${pages[state.page]}: ${parameterText}. ${voice}, octave ${state.octave}.`;
      if(state.screen!=='play')summary+=` ${state.screen.toUpperCase()}${state.destination!==null?' '+slot(state.bank*16+state.destination):''}.`;
      if(state.page===2)summary+=` Attack ${envelopeTimes(state)[0]} ms, decay ${envelopeTimes(state)[1]} ms, release ${envelopeTimes(state)[2]} ms; schematic proportions.`;
      if(state.pattern!==null)summary+=` Pattern ${slot(state.pattern)} playing${state.queued!==null?', '+slot(state.queued)+' queued':''}.`;
      query('[data-screen-summary]').textContent=summary;
      query<HTMLButtonElement>('[data-action="click"]').setAttribute('aria-pressed',String(state.recClick));
      query<HTMLButtonElement>('[data-action="second"]').disabled=state.screen!=='recording';
      query<HTMLButtonElement>('[data-action="boundary"]').disabled=state.queued===null;
      query<HTMLButtonElement>('[data-action="record"]').disabled=!['play','armed','recording'].includes(state.screen);
      query<HTMLButtonElement>('[data-action="patterns"]').disabled=!['play','recording','patterns'].includes(state.screen);
      query<HTMLButtonElement>('[data-action="menu"]').disabled=['choose','armed','recording','saving','patterns'].includes(state.screen);
      query<HTMLButtonElement>('[data-action="value"]').disabled=['choose','armed','recording','saving','patterns','logo'].includes(state.screen);
      held.disabled=state.screen!=='play';
      paint();
    };
    const stop=()=>{cancelAnimationFrame(frame);frame=0;last=0;};
    const tick=(now:number)=>{
      if(!animate||!visible||document.hidden){stop();return;}
      if(!last||now-last>=93.75){phase=(phase+1)&63;paint();last=now;}frame=requestAnimationFrame(tick);
    };
    const resume=()=>{if(animate&&visible&&!document.hidden&&!frame)frame=requestAnimationFrame(tick);};
    sound.addEventListener('change',()=>{loadSound(state,Number(sound.value));update();});
    page.addEventListener('change',()=>{setPage(state,Number(page.value));update();});
    bank.addEventListener('change',()=>{state.bank=Number(bank.value);state.message='Bank changed in the illustrative chooser.';update();});
    knobs.forEach((knob,i)=>{knobPacket(state,i,Number(knob.value));knob.addEventListener('input',()=>{knobPacket(state,i,Number(knob.value));state.message=`${labels[state.page][i]} now follows CTRL ${i+1}. Other parameters keep their values.`;update();});});
    const down=(index:number)=>{note(state,index,true);update();},up=(index:number)=>{note(state,index,false);update();};
    pads.forEach((pad,index)=>{
      pad.addEventListener('pointerdown',event=>{if(event.button!==0)return;pad.setPointerCapture(event.pointerId);down(index);});
      for(const kind of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(kind,()=>up(index));
      pad.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();if(!event.repeat)down(index);}});
      pad.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();up(index);}});
      pad.addEventListener('blur',()=>up(index));
      pad.addEventListener('click',event=>{if(event.detail===0&&!['play','recording'].includes(state.screen)){note(state,index,true);note(state,index,false);update();}});
    });
    this.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button=>button.addEventListener('click',()=>{
      switch(button.dataset.action){
        case 'value':valuePress(state);break;
        case 'previous':valueTurn(state,-1,held.checked);break;
        case 'next':valueTurn(state,1,held.checked);break;
        case 'menu':state.screen=state.screen==='play'?'menu':'play';state.selection=0;state.notes=[];state.message='Options contains SOUND, VOICE and LOGO. Turn VALUE to a row, then press it.';break;
        case 'exit':exitExample(state);break;
        case 'record':rec(state);break;
        case 'patterns':if(state.screen==='patterns')state.screen=state.patternReturn;else{state.patternReturn=state.screen==='recording'?'recording':'play';state.screen='patterns';}state.notes=[];state.message='Illustrative configured patterns: pads 1, 5, 10 and 15. Same playing pad stops; a different pad queues.';break;
        case 'click':state.recClick=!state.recClick;state.message=`REC CLK ${state.recClick?'on':'off'}. Stock SYSTEM > CLICK still controls level and output routing.`;break;
        case 'boundary':if(state.queued!==null){state.pattern=state.queued;state.queued=null;state.message='Illustrative pattern boundary: the queued pattern starts.';}break;
        case 'second':state.frames=Math.min(120*48000,state.frames+48000);if(state.frames===120*48000)rec(state);else state.message=`Illustrative ${state.frames/48000} seconds at a nominal 48 kHz. This is not a measured device timer.`;break;
        case 'animate':animate=!animate;button.setAttribute('aria-pressed',String(animate));button.textContent=animate?'Pause preview':'Animate preview';if(animate)resume();else stop();break;
        case 'reset':state=createExample();knobs.forEach((knob,i)=>{knob.value='64';knobPacket(state,i,64);});held.checked=false;phase=0;volume=96;query<HTMLInputElement>('[data-volume]').value='96';query('[data-volume-value]').textContent='76%';animate=false;stop();query<HTMLButtonElement>('[data-action="animate"]').setAttribute('aria-pressed','false');query('[data-action="animate"]').textContent='Animate preview';break;
      }update();
    }));
    query<HTMLInputElement>('[data-volume]').addEventListener('input',event=>{volume=Number((event.target as HTMLInputElement).value);query('[data-volume-value]').textContent=`${Math.round(volume*100/127)}%`;state.message=`Synth gain setting ${Math.round(volume*100/127)}%. This model has no audio output.`;update();});
    const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)resume();else stop();},{threshold:.1});observer.observe(this);
    document.addEventListener('visibilitychange',()=>{if(document.hidden){state.notes=[];stop();update();}else resume();});
    window.addEventListener('blur',()=>{state.notes=[];update();});
    canvases.forEach(canvas=>{canvas.hidden=false;canvas.previousElementSibling?.setAttribute('hidden','');});controls.hidden=false;update();
  }
}
if(!customElements.get('synth-examples'))customElements.define('synth-examples',SynthExamples);
