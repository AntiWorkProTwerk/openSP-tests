if(penpot.currentFile?.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3'||penpot.currentPage.name!=='Emulator components')throw Error('Open the native emulator mains');
const find=(root,name)=>{const s=penpotUtils.findShape(s=>s.name.replace(/\s*\/\s*/g,'/')===name,root);if(!s)throw Error('Missing '+name);return s;};
const result=[];
for(const mobile of [false,true]){
 const main=penpot.library.local.components.find(c=>c.path==='OpenSP / Emulator'&&c.name===`Emulator status (${mobile?'Mobile':'Desktop'})`).mainInstance();
 const message=find(main,'State message');message.resize(message.width,74);
 const label=find(main,'copy/start'),button=label.parent,border=find(button,'Button border');
 button.resize(104,44);border.resize(104,44);label.resize(80,24);
 find(main,'copy/reset').parent.x=main.x+120;
 result.push({id:main.id,messageHeight:message.height,startWidth:button.width});
 await new Promise(r=>setTimeout(r,25));
}
return result;
