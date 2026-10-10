const d=storage.synthRelease,figure=__FIGURE__,spec=__SPEC__;
if(!d)throw Error('Load release helper');
d.recordingFigure=mobile=>d.make('openSynth recording figure'+(mobile?' (Mobile)':' (Desktop)'),mobile?342:760,mobile?1250:650,mobile?13:12,b=>{
  const width=mobile?342:352,scale=width/128,rowHeight=64*scale+96;
  const walk=(src,dst,parentX,parentY)=>{dst.resize(src.width*scale,src.height*scale);dst.x=parentX+src.x*scale;dst.y=parentY+src.y*scale;if(src.type==='text'){dst.fontSize=String(Number(src.fontSize)*scale);dst.lineHeight=src.lineHeight;dst.characters=src.characters;}if(src.children){if(src.children.length!==dst.children.length)throw Error('Copy structure changed');for(let i=0;i<src.children.length;i++)walk(src.children[i],dst.children[i],parentX,parentY);}};
  for(const[i,state]of spec.states.entries()){
    const c=d.components[state.main];if(!c)throw Error('Missing linked direct-recording state');const source=c.mainInstance(),x=mobile?0:(i%2)*408,y=mobile?i*rowHeight:Math.floor(i/2)*rowHeight,v=d.instance(state.main,b,x,y);
    const resize=(src,dst)=>{dst.resize(src.width*scale,src.height*scale);dst.x=b.x+x+(src.x-source.x)*scale;dst.y=b.y+y+(src.y-source.y)*scale;if(src.type==='text'){dst.fontSize=String(Number(src.fontSize)*scale);dst.lineHeight=src.lineHeight;dst.characters=src.characters;}if(src.children){if(src.children.length!==dst.children.length)throw Error('Copy structure changed');for(let j=0;j<src.children.length;j++)resize(src.children[j],dst.children[j]);}};
    resize(source,v);d.text(b,'Figure caption '+state.id,figure.captions[i],x,y+64*scale+12,width,16,'Caption','Ink',72);
  }
  const y=(mobile?4:2)*rowHeight;d.text(b,'Figure provenance',figure.evidence,0,y,b.width,16,'Caption','Muted',mobile?144:80);b.resize(b.width,y+(mobile?160:96));b.setPluginData('opensp-recording-figure',JSON.stringify({schema:1,product:'openSynth',mobile,originalDesign:true,deviceCapture:false,recordingQualified:false,source:'src/content/releases/synth-recording-figure.json'}));
});
return {loaded:true};
