if(penpot.currentFile.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3'||penpot.currentPage.name!=='Feature picker')throw Error('Wrong owned page');
const d=storage.featurePicker,rows=[];
for(const b of penpot.root.children.filter(b=>b.name.startsWith('Feature picker /'))){
 const mobile=b.name.includes('Mobile'),dark=b.name.includes('Dark'),name='Feature receipt'+(mobile?' (Mobile)':' (Desktop)');
 const existing=b.children.find(s=>s.isComponentHead?.()&&s.component()?.name===name);
 if(existing){rows.push({board:b.id,instance:existing.id,existed:true});continue;}
 const notes=b.children.find(s=>s.isComponentHead?.()&&s.component()?.name==='Feature update notes'+(mobile?' (Mobile)':' (Desktop)'));
 if(!notes)throw Error('Missing existing notes');
 const y=notes.y-b.y,delta=(mobile?388:304)+40;
 for(const s of b.children)if(s.y-b.y>=y)s.y+=delta;
 b.resize(b.width,b.height+delta);
 const panel=d.instance(name,b,mobile?24:64,y);
 if(dark)d.dark(panel);
 rows.push({board:b.id,name:b.name,instance:panel.id,component:panel.component().id,x:panel.x-b.x,y:panel.y-b.y,width:panel.width,height:panel.height});
}
return {layouts:rows,kind:'linked-native-component-insertion',deviceEvidence:false};
