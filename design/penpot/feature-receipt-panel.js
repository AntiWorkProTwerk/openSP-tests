if(penpot.currentFile.id!=='24d9d841-759d-81bc-8008-b518bc70d8b3')throw Error('Wrong owned file');
const d=storage.featurePicker;
if(!d)throw Error('Load the shared feature library first');
const result=[];
for(const mobile of [false,true]){
 const name='Feature receipt'+(mobile?' (Mobile)':' (Desktop)'),w=mobile?342:1312,h=mobile?388:304;
 result.push(await d.make(name,w,h,mobile?16:15,b=>{
  d.rect(b,'Receipt divider',0,0,w,1);
  d.text(b,'copy/receiptHeading',d.copy.receiptHeading,0,24,w,28,'Heading','Ink',42);
  d.text(b,'copy/receiptNote',d.copy.receiptNote,0,82,mobile?w:1000,16,'Caption','Ink',mobile?120:48);
  const y=mobile?218:146;
  d.button(b,d.copy.receiptChoose,0,y,160);
  d.button(b,d.copy.receiptClear,172,y,160,true);
  d.text(b,'copy/receiptLimit',d.copy.receiptLimit,0,y+60,mobile?w:1000,14,'Caption','Muted',mobile?48:24);
  d.text(b,'Receipt status',d.copy.receiptEmpty,0,y+(mobile?122:96),w,16,'Caption','Ink',36);
 }));
}
return {components:result,copySource:'src/content/features.json',deviceEvidence:false};
