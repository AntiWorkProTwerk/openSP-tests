if(penpot.currentFile?.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3')throw Error('OpenSP only');
const lib=penpot.library.local;
const d=storage.emulatorFooter={copy:__COPY__,colors:Object.fromEntries(lib.colors.map(c=>[c.name,c])),types:Object.fromEntries(lib.typographies.map(t=>[t.name,t]))};
d.find=(s,n)=>{const t=penpotUtils.findShape(t=>t.name===n,s);if(!t)throw Error('Missing '+n);return t;};
d.put=(s,p,x,y,w,h)=>{if(s.parent?.id!==p.id)p.appendChild(s);s.resize(w,h);s.x=p.x+x;s.y=p.y+y;};
d.visible=s=>{for(let p=s;p;p=p.parent)if(p.hidden||p.name.startsWith('Archive'))return false;return true;};
d.main=async()=>{
 if(penpot.currentPage.name!=='Design system')throw Error('Open Design system');
 const footer=lib.components.find(c=>c.path==='OpenSP'&&c.name==='Footer').mainInstance();
 const before=footer.children.filter(s=>s.type==='text').map(s=>({id:s.id,name:s.name,text:s.characters}));
 let utility=lib.components.find(c=>c.path==='OpenSP'&&c.name==='Utility link');
 if(!utility){const b=penpot.createBoard();b.name='Utility link';b.x=1480;b.y=1300;b.resize(160,24);b.fills=[];const t=penpot.createText(d.copy.title);t.name='Utility label';t.applyTypography(d.types.Navigation);t.lineHeight=d.types.Navigation.lineHeight;t.fontSize='13';t.letterSpacing='0';t.textDecoration='underline';t.fills=[d.colors.Ink.asFill()];d.put(t,b,0,0,160,24);utility=lib.createComponent([b]);utility.name='Utility link';utility.path='OpenSP';}
 d.find(utility.mainInstance(),'Utility label').characters=d.copy.title;
 let link=footer.children.find(s=>s.isComponentHead()&&s.component()?.id===utility.id);if(!link){link=utility.instance();link.name='Utility link';footer.appendChild(link);}
 d.put(d.find(footer,'Project note'),footer,0,24,500,24);d.put(d.find(footer,'Preview note'),footer,520,24,608,24);d.put(link,footer,1152,24,160,24);
 footer.setPluginData('opensp-utility-link','Firmware emulator / semantic footer link / 2026-10-02');
 if(before.some(v=>d.find(footer,v.name).characters!==v.text))throw Error('Footer text changed');
 return {footerId:footer.id,utilityId:utility.id,textPreserved:true};
};
d.plan=()=>{
 const footers=penpotUtils.findShapes(s=>s.isComponentHead()&&s.isComponentCopyInstance()&&s.component()?.name==='Footer'&&d.visible(s),penpot.root);
 d.expectedPage=penpot.currentPage.id;d.queue=footers.map(footer=>({footer,before:footer.children.filter(s=>s.type==='text').map(s=>({name:s.name,text:s.characters})),height:footer.height}));
 return {page:penpot.currentPage.name,count:d.queue.length};
};
d.batch=async()=>{
 if(penpot.currentFile.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3'||penpot.currentPage.id!==d.expectedPage)throw Error('Footer page changed');const results=[];for(const {footer,before,height}of d.queue.splice(0,2)){
   const utility=lib.components.find(c=>c.path==='OpenSP'&&c.name==='Utility link');
   let link=footer.children.find(s=>s.isComponentHead()&&s.component()?.id===utility.id);if(!link){link=utility.instance();link.name='Utility link';footer.appendChild(link);}
   await new Promise(r=>setTimeout(r,25));const mobile=footer.width<700,w=footer.width,dark=footer.fills?.some(f=>f.fillColorRefId===d.colors['Dark paper'].id)||d.find(footer,'Project note').fills?.some(f=>[d.colors['Dark ink'].id,d.colors['Dark muted'].id].includes(f.fillColorRefId));
   if(mobile){const note=d.find(footer,'Preview note'),y=Math.max(76,note.y-footer.y);d.put(link,footer,0,y+28,w,24);const newHeight=Math.max(height,y+56);footer.resize(w,newHeight);let root=footer.parent;while(root?.parent&&root.parent.id!=='00000000-0000-0000-0000-000000000000')root=root.parent;if(root?.type==='board'&&newHeight>height)root.resize(root.width,root.height+newHeight-height);}
   else{d.put(d.find(footer,'Project note'),footer,0,24,Math.max(300,w*.38),24);d.put(d.find(footer,'Preview note'),footer,w*.4,24,w*.6-184,24);d.put(link,footer,w-160,24,160,24);}
   const t=d.find(link,'Utility label');d.put(t,link,0,0,160,24);t.fills=[d.colors[dark?'Dark ink':'Ink'].asFill()];
   if(before.some(v=>d.find(footer,v.name).characters!==v.text))throw Error('Footer text changed');
   footer.setPluginData('opensp-utility-fit','Responsive linked utility / 2026-10-02');results.push({id:footer.id,width:w,mobile,dark,height:footer.height,textPreserved:true,linked:link.isComponentCopyInstance(),utilityId:link.component()?.id});
 }
 return {remaining:d.queue.length,results};
};
d.inspectRoot=(root,page)=>({page,footers:penpotUtils.findShapes(s=>s.isComponentHead()&&s.component()?.name==='Footer'&&d.visible(s),root).map(footer=>({id:footer.id,name:footer.name,width:footer.width,height:footer.height,links:footer.children.filter(s=>s.isComponentHead()).map(s=>({name:s.name,componentId:s.component()?.id,component:s.component()?.name,x:s.x-footer.x,y:s.y-footer.y,width:s.width,height:s.height})),text:penpotUtils.findShapes(s=>s.type==='text',footer).map(t=>({name:t.name,text:t.characters,x:t.x-footer.x,y:t.y-footer.y,width:t.width,height:t.height,fontSize:Number(t.fontSize),colors:t.fills.map(f=>({color:f.fillColor,ref:f.fillColorRefId})),ink:t.textBounds?{x:t.textBounds.x-footer.x,y:t.textBounds.y-footer.y,width:t.textBounds.width,height:t.textBounds.height}:null}))}))});
d.inspect=()=>d.inspectRoot(penpot.root,penpot.currentPage.name);
d.inspectPage=name=>d.inspectRoot(penpotUtils.getPageByName(name).root,name);
d.fitOne=async()=>{
 if(penpot.currentFile.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3'||penpot.currentPage.id!==d.expectedPage)throw Error('Footer page changed');
 const entry=d.queue.shift();if(!entry)return {remaining:0,results:[]};const {footer,before,height}=entry,w=footer.width;
 const link=footer.children.find(s=>s.isComponentHead()&&s.component()?.name==='Utility link');if(!link)throw Error('Shared Footer child did not propagate');
 const project=d.find(footer,'Project note'),dark=project.fills.some(f=>[d.colors['Dark ink'].id,d.colors['Dark muted'].id].includes(f.fillColorRefId)),mobile=w<700;
 if(mobile){const note=d.find(footer,'Preview note'),y=Math.max(76,note.y-footer.y);link.x=footer.x;link.y=footer.y+y+28;link.resize(w,24);const target=Math.max(height,y+56);footer.resize(w,target);if(footer.y+target>footer.parent.y+footer.parent.height)footer.parent.resize(footer.parent.width,footer.y+target-footer.parent.y+16);}
 d.find(link,'Utility label').fills=[d.colors[dark?'Dark ink':'Ink'].asFill()];
 if(before.some(v=>d.find(footer,v.name).characters!==v.text))throw Error('Footer text changed');
 footer.setPluginData('opensp-utility-fit','Responsive linked utility / 2026-10-02');await new Promise(r=>setTimeout(r,25));
 return {remaining:d.queue.length,results:[{id:footer.id,width:w,height:footer.height,mobile,dark,textPreserved:true,linked:link.isComponentCopyInstance(),utilityId:link.component()?.id}]};
};
return {loaded:true,page:penpot.currentPage.name};
