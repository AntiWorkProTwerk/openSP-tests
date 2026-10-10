const d=storage.synthRelease;
if(!d)throw Error('Load synth release helper');
const normalized=s=>s.name.replace(/\s*\/\s*/g,'/');
d.refitMain=name=>{
  d.guard('Release components');
  const b=d.components[name]?.mainInstance();if(!b)throw Error('Missing main '+name);
  const mobile=name.endsWith('(Mobile)'),w=mobile?342:760;
  const findName=value=>{const s=b.children.find(s=>normalized(s)===value);if(!s)throw Error('Missing shared copy '+value);return s;};
  const body=(key,value,y,size=mobile?18:20,muted=false,role=null)=>{const s=findName(key),t=d.find(s,'Paragraph'),h=d.height(value,w,size);t.characters=value;if(role)t.applyTypography(d.types[role]);t.fontSize=String(size);t.lineHeight='1.6';t.fills=[d.colors[muted?'Muted':'Ink'].asFill()];d.put(s,b,0,y,w,h);d.put(t,s,0,0,w,h);return h;};
  let y=0;
  if(name.includes('introduction')){
    const title=findName('copy/title');title.characters=d.copy.title;title.fontSize=String(mobile?48:60);title.lineHeight='1.12';d.put(title,b,0,0,b.width,mobile?180:144);y=title.height+24;
    y+=body('copy/introduction',d.copy.introduction,y)+20;
    y+=body('copy/status',d.copy.status,y,18,true)+24;
    const link=findName('copy/featureLink');link.characters=d.copy.featureLink.label;d.put(link,b,0,y,b.width,48);y+=48;
    let guide=b.children.find(s=>normalized(s)==='copy/guideLink');if(!guide)guide=d.text(b,'copy/guideLink',d.copy.guideLink.label,0,y,b.width,16,'Caption','Ink',48);else {guide.characters=d.copy.guideLink.label;d.put(guide,b,0,y,b.width,48);}y+=48;
    if(d.copy.patcherLink)y+=body('copy/patcherLink',d.copy.patcherLink.label,y,16)+16;
  }else{
    const section=d.copy.sections.find(s=>name==='Synth release '+s.id+(mobile?' (Mobile)':' (Desktop)'));if(!section)throw Error('Unknown section main');
    const heading=b.children.find(s=>s.isComponentHead()&&s.component()?.name==='Article heading'),t=d.find(heading,'Heading');t.characters=section.heading;t.fontSize='32';t.lineHeight='1.25';d.put(heading,b,0,32,b.width,mobile?88:56);d.put(t,heading,0,0,b.width,heading.height);y=32+heading.height+16;
    for(const[i,value]of section.paragraphs.entries())y+=body('copy/'+section.id+'/paragraph/'+i,value,y)+20;
    if(section.id==='recording'){
      const figureName='openSynth recording figure'+(mobile?' (Mobile)':' (Desktop)'),component=d.components[figureName];
      if(component){let figure=b.children.find(s=>s.isComponentHead()&&s.component()?.id===component.id);if(!figure)figure=d.instance(figureName,b,0,y);d.put(figure,b,0,y);y+=figure.height+32;}
    }
    for(const[i,row]of(section.rows||[]).entries())y+=body('copy/'+section.id+'/row/'+i,row.label+'\n'+row.text,y)+24;
    for(const[i,value]of(section.steps||[]).entries())y+=body('copy/'+section.id+'/step/'+i,(i+1)+'. '+value,y)+20;
    for(const[i,row]of(section.commands||[]).entries())y+=body('copy/'+section.id+'/command/'+i,row.label+'\n'+row.text,y,14,false,'Code')+24;
    if(section.note)y+=body('copy/'+section.id+'/note',section.note,y,16,true)+16;
  }
  b.resize(b.width,y+24);b.setPluginData('opensp-release-fit','reading-column-v2-normalized-copy');return {name,id:b.id,width:b.width,height:b.height};
};
d.refitLayout=id=>{
  d.guard('Synth release');const b=penpot.root.children.find(b=>b.id===id);if(!b)throw Error('Missing board');
  const meta=JSON.parse(b.getPluginData('opensp-synth-release')),mobile=meta.mobile,g=mobile?24:64,x=mobile?24:384;let y=136;
  const intro=b.children.find(s=>s.isComponentHead()&&s.component()?.name.startsWith('Synth release introduction'));if(!intro)throw Error('Missing introduction');
  if(mobile){const contents=b.children.find(s=>s.name==='Release contents'),t=d.find(contents,'Paragraph');t.characters=d.copy.sections.map(s=>s.heading).join('\n')+'\n'+d.copy.baseline+'\n'+d.copy.baselineNote;t.applyTypography(d.types.Label);t.fontSize='13';t.lineHeight='1.6';const h=d.height(t.characters,342,13);d.put(contents,b,x,y,342,h);d.put(t,contents,0,0,342,h);y+=h+32;}
  d.put(intro,b,x,y);y+=intro.height+40;
  if(!mobile){
    const contents=b.children.find(s=>s.isComponentHead()&&s.component()?.name==='Contents rail'),links=penpotUtils.findShapes(s=>s.type==='text'&&s.name.startsWith('Link /'),contents);
    if(links.length<d.copy.sections.length)throw Error('Contents rail lacks linked source slots');
    for(const[i,t]of links.entries()){if(d.copy.sections[i]){t.hidden=false;t.characters=d.copy.sections[i].heading;d.put(t,contents,0,48+i*64,240,60);}else t.hidden=true;}
    const ruleY=48+d.copy.sections.length*64+16,evidence=d.find(contents,'Evidence label');evidence.characters=d.copy.baseline+'\n'+d.copy.baselineNote;
    d.put(d.find(contents,'Rule'),contents,0,ruleY,224,1);d.put(evidence,contents,0,ruleY+20,236,64);d.put(d.find(contents,'All guides'),contents,0,ruleY+100,230,32);contents.resize(240,ruleY+148);
  }
  for(const section of d.copy.sections){const s=b.children.find(s=>s.isComponentHead()&&s.component()?.name==='Synth release '+section.id+(mobile?' (Mobile)':' (Desktop)'));if(!s)throw Error('Missing section');d.put(s,b,x,y);y+=s.height+24;}
  const footer=b.children.find(s=>s.name==='Release footer');footer.characters=d.copy.footer;d.put(footer,b,g,y);b.resize(b.width,y+80);if(meta.dark)d.dark(b);return {id:b.id,name:b.name,height:b.height};
};
return {loaded:true};
