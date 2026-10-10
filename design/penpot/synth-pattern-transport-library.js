if(penpot.currentFile?.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3'||penpot.currentPage.name!=='Synth components')throw Error('Open approved Synth components');
const lib=penpot.library.local,spec=__SPEC__,colors=Object.fromEntries(lib.colors.map(c=>[c.name,c]));
const shared=name=>{const c=lib.components.find(c=>c.name===name);if(!c)throw Error('Missing linked main '+name);return c;};
const at=(s,p,x,y)=>{if(p&&s.parent?.id!==p.id)p.appendChild(s);s.x=(p?.x||0)+x;s.y=(p?.y||0)+y;return s;};
const find=(p,name)=>{const s=penpotUtils.findShape(s=>s.name===name,p);if(!s)throw Error('Missing '+name);return s;};
const state=spec.states[0],existing=lib.components.find(c=>c.name===state.main);
if(existing)return {id:existing.id,main:existing.mainInstance().id,existed:true};
if(penpot.root.children.some(s=>s.name===state.main))throw Error('Inspect partial pattern main');
const b=penpot.createBoard();b.name=state.main;b.resize(128,64);b.fills=[colors['OLED black'].asFill()];at(b,null,160,Math.max(0,...penpot.root.children.filter(s=>s.id!==b.id).map(s=>s.y+s.height))+64);
const header=at(shared('OLED header').instance(),b,0,0),heading=find(header,'Heading');heading.characters=state.header;heading.fontSize='6';heading.lineHeight='1';heading.resize(122,8);at(heading,header,3,1);
const footer=at(shared('OLED footer').instance(),b,0,55),hint=find(footer,'Hint');hint.characters=state.footer;hint.fontSize='5';hint.lineHeight='1';hint.resize(122,7);at(hint,footer,3,1);
for(let i=0;i<16;i++){const cell=at(shared('P6N record pad cell').instance(),b,3+(i%4)*30,13+Math.floor(i/4)*10);cell.name='Pattern slot '+String(i+1).padStart(2,'0');find(cell,'Pad number').characters=String(i+1).padStart(2,'0');find(cell,'Occupied marker').hidden=![2,5,10].includes(i);}
b.setPluginData('opensp-pattern-transport',JSON.stringify({...spec,physicalTransport:false,renderedCapture:false}));
const component=lib.createComponent([b]);component.name=state.main;component.path='OpenSP / Synth / Pattern transport';
return {id:component.id,main:b.id,state:state.id};
