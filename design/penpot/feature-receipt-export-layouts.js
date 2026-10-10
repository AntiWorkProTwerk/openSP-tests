if(penpot.currentFile.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3'||penpot.currentPage.name!=='Feature picker')throw Error('Wrong owned page');
const visible=s=>{for(let p=s;p;p=p.parent)if(p.hidden)return false;return true;};
return {source:{fileId:penpot.currentFile.id,pageId:penpot.currentPage.id,kind:'native-layout-api-export'},boards:penpot.root.children.filter(s=>s.type==='board'&&s.name.startsWith('Feature picker /')).map(b=>({
 id:b.id,name:b.name,width:b.width,height:b.height,metadata:JSON.parse(b.getPluginData('opensp-feature-picker')),
 linkedComponents:penpotUtils.findShapes(s=>visible(s)&&s.isComponentHead(),b).map(s=>({id:s.id,name:s.name,componentId:s.component()?.id,component:s.component()?.name,copy:s.isComponentCopyInstance()})),
 text:penpotUtils.findShapes(s=>visible(s)&&s.type==='text',b).map(s=>({name:s.name,text:s.characters,x:s.x-b.x,y:s.y-b.y,width:s.width,height:s.height,size:Number(s.fontSize),ink:s.textBounds?{x:s.textBounds.x-b.x,y:s.textBounds.y-b.y,width:s.textBounds.width,height:s.textBounds.height}:null}))
}))};
