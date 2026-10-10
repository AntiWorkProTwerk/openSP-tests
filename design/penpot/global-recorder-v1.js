if(penpot.currentFile.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3')throw Error('OpenSP only');
const d=storage.featurePicker;
if(!d)throw Error('Load feature picker helpers');
d.globalRecorder=()=>d.make('Global PC recorder',1280,800,11,b=>{
  b.fills=[d.colors.Paper.asFill()];
  d.text(b,'Recorder title','SP USB recorder',32,24,740,28,'Heading','Ink',42);
  d.text(b,'Recorder state','DISCONNECTED',840,30,408,13,'Label','Muted',24);
  d.text(b,'Screen label','SP screen',32,76,768,18,'Heading','Muted',28);
  const oled=d.instance('Emulator blank OLED',b,32,112);oled.resize(768,384);d.put(d.find(oled,'OLED screen background'),oled,0,0,768,384);
  d.text(b,'Screen waiting','Waiting for SP screen',192,282,448,22,'Caption','Dark muted',40).align='center';
  d.text(b,'Control heading','Observed controls',840,76,408,18,'Heading','Muted',28);
  for(let i=0;i<16;i++){const pad=d.instance('P6 PC Pad',b,840+(i%4)*80,116+Math.floor(i/4)*52);d.find(pad,'Number').characters=String(i+1).padStart(2,'0')+' ?';pad.opacity=.7;}
  for(let i=0;i<4;i++){const knob=d.instance('P6 PC CTRL',b,840+(i%2)*176,340+Math.floor(i/2)*88);d.find(knob,'Control').characters=['VOLUME','CTRL 1','CTRL 2','CTRL 3'][i];d.find(knob,'Value').characters='Unknown';d.find(knob,'Fill').hidden=true;}
  const toolbar=d.instance('P6 PC Capture toolbar',b,32,530);d.find(toolbar,'Record label').characters='Record';toolbar.opacity=.55;
  d.text(b,'Event heading','Recent button / pressure events',840,528,408,14,'Caption','Muted',24);
  d.text(b,'Event unknown','No event received · pressure unknown',840,560,408,14,'Caption','Muted',48);
  d.text(b,'Audio label','USB audio input',840,612,408,14,'Caption','Muted',24);d.rect(b,'Audio field',840,640,408,36,'Paper','Line');d.text(b,'Audio value','Select a verified SP USB audio input',852,646,384,14,'Caption','Muted',24);
  d.text(b,'Port label','SP application port',840,688,408,14,'Caption','Muted',24);d.rect(b,'Port field',840,716,408,36,'Paper','Line');d.text(b,'Port value','No application port selected',852,722,384,14,'Caption','Muted',24);
  d.text(b,'Profile capability','Profile unknown · screen/control capture unavailable',32,606,768,16,'Caption','Muted',32);
  d.text(b,'Timing limitation','Audio is recorded separately. Audio/video alignment is unmeasured.',32,644,768,14,'Caption','Muted',40);
  d.button(b,'Replay',32,704,112,true);d.button(b,'Lossless WAV',160,704,160,true);d.button(b,'Video',336,704,112,true);d.button(b,'Control log',464,704,152,true);
  d.text(b,'Evidence scope','Design example. No physical global recording result.',32,766,768,13,'Label','Muted',24);
  b.setPluginData('opensp-global-recorder',JSON.stringify({schema:1,logicalOLED:[128,64],oled:[32,112,768,384],source:'linked P6 PC components',profileDeclared:false,physicalGlobalRecording:false,unknownInputs:true,pressureSnapshot:false}));
});
d.globalLayout=async(state,dark)=>{if(penpot.currentPage.name!=='Global recorder')throw Error('Open Global recorder');const name='Global recorder / '+state+' / '+(dark?'Dark':'Light');if(penpot.root.children.some(s=>s.name===name))throw Error('Inspect existing recorder layout');const b=d.board(name,dark?1400:0,['Disconnected','Declared SPG1','Replay gap'].indexOf(state)*950,1280,800,'Paper');const panel=d.instance('Global PC recorder',b,0,0);if(state==='Declared SPG1'){d.find(panel,'Recorder state').characters='WAITING FOR STREAM';d.find(panel,'Profile capability').characters='Declared SPG1 v5.52 · screen + control stream; USB audio is separate';}if(state==='Replay gap'){d.find(panel,'Recorder state').characters='REPLAY / GAP';d.find(panel,'Profile capability').characters='Recorded SPG1 v5.52 profile · gap clears control validity';d.find(panel,'Screen waiting').characters='Screen unavailable in this replay gap';d.find(panel,'Event unknown').characters='Gap: input state unknown until observed again';}if(dark)d.dark(b);b.setPluginData('opensp-global-recorder-state',JSON.stringify({schema:1,state,dark,illustrative:true,capturedFrame:false,linked:true}));return {id:b.id,name:b.name};};
return {loaded:true};
