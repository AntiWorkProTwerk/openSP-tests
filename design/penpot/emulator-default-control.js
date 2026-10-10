if(penpot.currentFile?.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3')throw Error('OpenSP only');
const page=penpot.currentPage.name;
if(!['Emulator components','Emulator'].includes(page))throw Error('Open a small emulator page');
const roots=page==='Emulator components'
 ?penpot.library.local.components.filter(c=>c.path==='OpenSP / Emulator'&&/^Emulator (inputs|session) /.test(c.name)).map(c=>c.mainInstance())
 :penpot.root.children.filter(s=>s.type==='board'&&s.name.startsWith('Firmware emulator /'));
const result=[];
for(const root of roots){
 if(penpot.currentFile.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3'||penpot.currentPage.name!==page)throw Error('Page changed');
 const text=penpotUtils.findShape(s=>s.type==='text'&&s.name.replace(/\s*\/\s*/g,'/')==='Value/control',root);
 if(!text)throw Error('Missing initial control field: '+root.name);
 if(!['SHIFT','VALUE PRESS'].includes(text.characters))throw Error('Unexpected control value');
 text.characters='VALUE PRESS';result.push({root:root.id,text:text.id,characters:text.characters});
 await new Promise(r=>setTimeout(r,25));
}
return result;
