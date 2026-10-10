if(penpot.currentFile.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3'||penpot.currentPage.id!==storage.emulatorFooter?.expectedPage)throw Error('Active footer page changed');
const d=storage.emulatorFooter;
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
return {optimized:true,remaining:d.queue.length};
