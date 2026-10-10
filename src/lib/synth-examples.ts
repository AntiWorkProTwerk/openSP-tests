import data from '../content/releases/synth-example-data.json' with {type:'json'};

export const sounds = data.presets;
export const pages = ['TONE', 'OSC', 'AMP', 'MOD'] as const;
export const labels = [['CUT', 'RES', 'ENV'], ['MIX', 'DET', 'PW'], ['ATK', 'DEC', 'REL'], ['RATE', 'DEP', 'GLD']];
export type Screen = 'play'|'menu'|'sound'|'voice'|'logo'|'patterns'|'choose'|'armed'|'recording'|'saving';
export interface SynthExample {
  preset:number; page:number; values:number[]; physical:number[]; known:boolean[];
  mono:boolean; octave:number; modified:boolean; screen:Screen; selection:number;
  bank:number; destination:number|null; frames:number; notes:number[];
  pattern:number|null; queued:number|null; patternReturn:'play'|'recording'; recClick:boolean; message:string;
}
export function createExample():SynthExample {
  const preset=sounds[0];
  return {preset:0,page:0,values:[...preset.values],physical:[64,64,64],known:[false,false,false],mono:preset.mono,octave:preset.octave,modified:false,screen:'play',selection:0,bank:0,destination:null,frames:0,notes:[],pattern:null,queued:null,patternReturn:'play',recClick:false,message:'Soft Sine defaults. Move a CTRL knob to take control of its parameter.'};
}
export function loadSound(s:SynthExample,index:number) {
  const preset=sounds[Math.max(0,Math.min(15,index))];
  s.preset=sounds.indexOf(preset);s.values=[...preset.values];s.mono=preset.mono;s.octave=preset.octave;s.modified=false;
  s.message=`${preset.name} defaults restored. Physical knob positions stay where you left them; parameters wait for movement.`;
}
export function knobPacket(s:SynthExample,index:number,raw:number) {
  if(index<0||index>2||!Number.isInteger(raw)||raw<0||raw>127)return false;
  const moved=s.known[index]&&raw!==s.physical[index];
  s.known[index]=true;s.physical[index]=raw;
  if(moved){s.values[s.page*3+index]=Math.floor((raw*4095+63)/127);s.modified=true;}
  return moved;
}
export function setPage(s:SynthExample,index:number){s.page=Math.max(0,Math.min(3,index));s.message=`${pages[s.page]}: defaults and earlier edits remain until a knob moves.`;}
export function note(s:SynthExample,pad:number,down:boolean){
  if(pad<0||pad>15)return;
  if(down){
    if(s.screen==='choose'){
      if([0,3,8,11].includes(pad)){s.message='Illustrative occupied pad: selection refused.';return;}
      s.destination=pad;s.screen='armed';s.message='Destination selected. This press is consumed; REC starts the take.';return;
    }
    if(s.screen==='patterns'){
      if(![0,4,9,14].includes(pad)){s.message='No configured pattern in this illustrative slot.';return;}
      const target=s.bank*16+pad;
      if(s.pattern===target){s.pattern=null;s.queued=null;s.message='The same playing pattern was selected again: transport stops.';}
      else if(s.pattern===null){s.pattern=target;s.message='Pattern starts. The chooser closes; pads return to Synth notes.';}
      else{s.queued=target;s.message='A different pattern is queued. Advance its boundary to show the next pattern.';}
      s.screen=s.patternReturn;return;
    }
    if(['armed','saving','logo'].includes(s.screen))return;
    if(!s.notes.includes(pad))s.notes.push(pad);
  }else s.notes=s.notes.filter(n=>n!==pad);
}
export function valueTurn(s:SynthExample,delta:number,held=false){
  const step=delta<0?-1:1;
  if(s.screen==='play'){
    if(held){s.octave=Math.max(-2,Math.min(2,s.octave+step));s.modified=true;s.message='Held VALUE changes octave. Release after turning keeps the current page.';}
    else loadSound(s,s.preset+step);
  }else if(s.screen==='menu')s.selection=Math.max(0,Math.min(2,s.selection+step));
  else if(s.screen==='sound')s.selection=Math.max(0,Math.min(15,s.selection+step));
  else if(s.screen==='voice'){s.selection=step<0?1:0;s.message='Left selects MONO4; right selects POLY4. Press VALUE to apply.';}
  else if(['choose','patterns'].includes(s.screen))s.bank=Math.max(0,Math.min(9,s.bank+step));
}
export function valuePress(s:SynthExample){
  if(s.screen==='play')setPage(s,(s.page+1)%4);
  else if(s.screen==='menu'){
    s.screen=(['sound','voice','logo'] as const)[s.selection];
    s.selection=s.screen==='sound'?s.preset:s.mono?1:0;
    s.message=s.screen==='logo'?'Logo is an explicit Options choice. EXIT returns to Synth.':'Turn VALUE, then press it to select.';
  }else if(s.screen==='sound')loadSound(s,s.selection);
  else if(s.screen==='voice'){s.mono=!!s.selection;s.modified=true;s.screen='menu';s.selection=1;s.message='Voice mode applied in this browser model.';}
}
export function exitExample(s:SynthExample){
  s.notes=[];
  if(['sound','voice'].includes(s.screen)){s.screen='menu';s.selection=0;}
  else if(s.screen==='patterns'){s.screen=s.patternReturn;s.message='Pattern chooser closed. Pads return to Synth notes.';}
  else{s.screen='play';s.destination=null;s.message='Back to Synth. On the instrument, EXIT from the playing page returns to the sampler.';}
}
export function rec(s:SynthExample){
  if(s.screen==='play'){s.screen='choose';s.destination=null;s.notes=[];s.frames=0;s.message='Illustrative bank: occupied pads 1, 4, 9 and 12 are refused. Select an empty pad.';}
  else if(s.screen==='armed'){s.screen='recording';s.message='Recording model: pads play Synth notes. Pattern and click remain monitoring sources.';}
  else if(s.screen==='recording'){s.screen='saving';s.notes=[];s.message='SAVE remains unverified on hardware. This model stops at SAVING and never invents a saved pad.';}
}
export function duration(value:number,base:number,span:number,power:number){return base+Math.round((value/4095)**power*span);}
export function envelopeTimes(s:SynthExample){return [duration(s.values[6],1,3000,3),duration(s.values[7],15,2000,2),duration(s.values[8],20,4000,3)];}
export function slot(index:number|null){return index===null?'---':`${String.fromCharCode(65+Math.floor(index/16))}${String(index%16+1).padStart(2,'0')}`;}

// Original glyph masks and diagram coordinates follow the P11 source renderer.
// The waveform and note activity are illustrative browser data, never device PCM.
export function renderExample(s:SynthExample,phase=0):Uint8Array {
  const out=new Uint8Array(128*64),pixel=(x:number,y:number)=>{x=Math.trunc(x);y=Math.trunc(y);if(x>=0&&x<128&&y>=0&&y<64)out[y*128+x]=1;};
  const h=(x:number,y:number,n:number)=>{for(let i=0;i<n;i++)pixel(x+i,y);};
  const line=(x0:number,y0:number,x1:number,y1:number)=>{
    const dx=Math.abs(x1-x0),dy=Math.abs(y1-y0),steps=Math.max(dx,dy);
    for(let i=0;i<=steps;i++)pixel(Math.round(x0+(x1-x0)*i/(steps||1)),Math.round(y0+(y1-y0)*i/(steps||1)));
  };
  const text=(x:number,y:number,value:string,large=false,limit=125)=>{
    const width=large?5:3,rows=large?7:5,glyphs=large?data.font.large:data.font.small;
    for(const letter of value.toUpperCase()){
      if(x+width>limit)break;
      const code=letter.charCodeAt(0),mask=glyphs[code>=32&&code<=90?code-32:31];
      for(let r=0;r<rows;r++)for(let c=0;c<width;c++)if(mask[r]&(1<<(width-1-c)))pixel(x+c,y+r);
      x+=width+1;
    }
  };
  const footer=(value:string)=>{h(3,55,122);text(3,58,value);};
  const active=s.mono?Math.min(s.notes.length,1):Math.min(s.notes.length,4);
  if(s.screen==='logo'){
    const grid=new Uint8Array(36*14),depth=new Int16Array(36*14).fill(127),sin=data.logo.sine[phase&63],cos=data.logo.sine[(phase+16)&63];
    const div=(a:number,b:number)=>Math.trunc(a/b),project=(a:number,b:number)=>div(a+(a<0?-Math.trunc(b/2):Math.trunc(b/2)),b);
    data.logo.letters.forEach((glyph,letter)=>{for(let bit=0;bit<15;bit++)if(glyph&(1<<bit)){
      const x=(letter%8*4+bit%3-15)*4,y=(Math.floor(letter/8)*6+Math.floor(bit/3)-5)*4;
      for(let z=-6;z<=6;z+=6){const rx=div(x*cos+z*sin,256),rz=div(z*cos-x*sin,256),den=320+rz,gx=18+project(rx*80,den),gy=7+project((y*256-rz*40)*80,den*256);
        if(gx<0||gx>=36||gy<0||gy>=14)continue;const cell=gy*36+gx;
        if(rz<depth[cell]){depth[cell]=rz;grid[cell]=rz< -25?4:rz< -5?3:rz<20?2:1;}
      }
    }});
    const glyphs=[0,0x080,0x082,0x0ba,0x17d];
    grid.forEach((cell,i)=>{for(let bit=0;bit<9;bit++)if(glyphs[cell]&(1<<bit))pixel(10+i%36*3+bit%3,11+Math.floor(i/36)*3+Math.floor(bit/3));});
    text(34,56,'AntiWorkProTwerk',false,128);return out;
  }
  if(['choose','armed','recording','saving'].includes(s.screen)){
    const title={choose:'CHOOSE EMPTY PAD',armed:'ARMED',recording:'RECORDING',saving:'SAVING'}[s.screen as 'choose'|'armed'|'recording'|'saving'];
    text(3,1,'REC');text(23,1,title);text(3,11,`BANK ${String.fromCharCode(65+s.bank)}`);
    if(s.destination!==null)text(43,11,`PAD ${s.destination+1}`);
    if(s.screen==='choose'||s.screen==='armed')for(let pad=0;pad<16;pad++){
      const x=3+pad%8*15,y=22+Math.floor(pad/8)*13;
      text(x,y,String(pad+1));text(x+8,y,[0,3,8,11].includes(pad)?'X':'+');if(pad===s.destination)h(x,y+6,12);
    }else text(3,25,`FRAMES ${s.frames}`);
    text(3,58,s.screen==='choose'?'PAD:ARM BANK:CHANGE EXIT:CANCEL':s.screen==='armed'?'REC:START EXIT:CANCEL':s.screen==='recording'?'REC:STOP/SAVE EXIT:CANCEL':'EXIT:CANCEL');return out;
  }
  if(s.screen==='patterns'){
    text(3,1,`PAT ${String.fromCharCode(65+s.bank)}`);text(25,1,`CUR ${slot(s.pattern)}`);text(55,1,`N ${slot(s.queued)}`);text(81,1,s.recClick?'REC CLK ON':'REC CLK OFF');h(3,9,122);
    for(let pad=0;pad<16;pad++){
      const x=3+pad%4*30,y=13+Math.floor(pad/4)*10;h(x,y,28);h(x,y+7,28);line(x,y,x,y+7);line(x+27,y,x+27,y+7);
      text(x+2,y+2,slot(s.bank*16+pad));if(![0,4,9,14].includes(pad))text(x+21,y+2,'X');else if(s.pattern===s.bank*16+pad)text(x+15,y+2,'C');else if(s.queued===s.bank*16+pad)text(x+15,y+2,'N');
    }text(3,52,'PAD:START/STOP / QUEUE NEXT');h(3,57,122);text(3,59,'SHIFT+PATTERN:REC CLK EXIT:BACK');return out;
  }
  const menu=s.screen!=='play';text(3,1,menu?s.screen==='sound'?'SOUND':'openSynthP11':pages[s.page],false,menu?50:46);
  text(menu?52:48,1,s.mono?'MONO':'POLY4',false,menu?82:78);text(88,1,`${active}/4`,false,108);
  for(let i=0;i<4;i++){h(112+i*3,6,2);if(i<active){line(112+i*3,2,112+i*3,6);line(113+i*3,2,113+i*3,6);}}h(3,9,122);
  if(menu){
    if(s.screen==='sound'){
      const first=Math.min(12,Math.max(0,s.selection-1));for(let i=0;i<4;i++){text(10,12+i*9,`${String(first+i+1).padStart(2,'0')} ${sounds[first+i].name}`,false,117);if(first+i===s.selection)text(3,12+i*9,'>');if(first+i===s.preset)text(121,12+i*9,'*');}
      footer('VAL:LOAD EXIT:BACK');
    }else{
      text(10,12,'SOUND',false,34);text(38,12,`${String(s.preset+1).padStart(2,'0')} ${sounds[s.preset].name}`);text(10,21,'VOICE',false,34);text(38,21,(s.screen==='voice'?s.selection:s.mono)?'MONO4':'POLY4');text(10,30,'LOGO');text(3,12+(s.screen==='voice'?1:s.selection)*9,'>');footer(s.screen==='voice'?'TURN:VOICE VAL:SET EXIT:BACK':'VAL:ENTER EXIT:PLAY');
    }h(3,50,96);text(104,48,'MODEL');return out;
  }
  text(3,11,`${String(s.preset+1).padStart(2,'0')} ${sounds[s.preset].name}`,true,s.modified?93:98);if(s.modified)text(93,11,'*',true,98);text(101,11,`OCT ${s.octave<0?'-':'+'}${Math.abs(s.octave)}`);
  const preset=sounds[s.preset],wave=(type:number,t:number)=>type===0?Math.sin(t*Math.PI*2):type===1?1-4*Math.abs(t%1-.5):type===2?2*(t%1)-1:(t%1<s.values[5]/4095*.8+.1?1:-1);
  let previous=26;
  for(let x=0;x<96;x++){
    const t=x/24+phase/64,mix=s.values[3]/4095,sample=active?wave(preset.waveA,t)*(1-mix)+wave(preset.waveB,t*(1+s.values[4]/4095*.04))*mix:0;
    const y=26-Math.round(sample*(2+s.values[0]/4095*5));line(3+x,previous,3+x,y);previous=y;
  }text(104,21,active?'PLAY':'IDLE');text(104,28,'Z3');
  const v=s.values;
  if(s.page===0){const knee=10+Math.trunc(v[0]*75/4095),peak=Math.trunc(v[1]*4/4095),env=Math.trunc(v[2]*10/4095),highpass=preset.filter===2,start=highpass?43:39,end=highpass?39:43;h(3,start,knee-3);line(knee,start,knee+3,39-peak);line(knee+3,39-peak,knee+10,end);h(knee+10,end,99-knee-10);for(let x=knee+env+3;x<knee+env+11&&x<99;x+=2)pixel(x,35);text(104,36,'FILT');}
  else if(s.page===1){const width=10+Math.trunc(v[5]*76/4095),height=2+Math.trunc(v[3]*2/4095),shift=1+Math.trunc(v[4]*6/4095);h(3,39-height,width);line(3+width,39-height,3+width,39+height);h(3+width,39+height,96-width);for(let x=3;x<99;x+=3)pixel(x,x-3-shift>=0&&x-3-shift<width?35:43);text(104,36,'PULSE');}
  else if(s.page===2){const times=envelopeTimes(s),sum=times.reduce((a,b)=>a+b,0),aw=8+Math.trunc(58*times[0]/sum),dw=8+Math.trunc(58*times[1]/sum),sustain=43-Math.trunc((preset.sustain*8+127)/255);for(let x=0;x<=aw;x++)pixel(3+x,43-Math.trunc(8*x*x*(3*aw-2*x)/(aw*aw*aw)));line(3+aw,35,3+aw+dw,sustain);h(3+aw+dw,sustain,14);line(3+aw+dw+13,sustain,98,43);text(104,36,'ADSR');}
  else{const sine=[0,25,49,71,90,106,117,125,127,125,117,106,90,71,49,25,0,-25,-49,-71,-90,-106,-117,-125,-127,-125,-117,-106,-90,-71,-49,-25],period=76-Math.trunc(v[9]*60/4095),amp=1+Math.trunc(v[10]*3/4095);for(let x=0;x<76;x++)pixel(3+x,39-Math.trunc(sine[Math.trunc(x*32/period)%32]*amp/127));const glide=2+Math.trunc(v[11]*13/4095);line(81,43,81+glide,35);h(81+glide,35,18-glide);text(104,36,'LFO');}
  for(let j=0;j<3;j++){const value=v[s.page*3+j],x=3+j*42; text(x,45,labels[s.page][j],false,x+23);const n=String(Math.floor((value*100+2047)/4095));text(x+40-n.length*4,45,n,false,x+40);h(x,53,39);h(x,52,Math.floor((value*38+2047)/4095));}
  footer('VAL:SND/PAGE SHIFT:MENU');return out;
}
export function bitmapPath(pixels:Uint8Array){let path='';pixels.forEach((value,index)=>{if(value)path+=`M${index%128} ${Math.floor(index/128)}h1v1h-1z`;});return path;}
