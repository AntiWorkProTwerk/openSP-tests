import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const root=path.resolve(import.meta.dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const profilePath='../sp404mk2-synth/diagnostics/global_usb_stream_v552/PROFILE_V552.json';
const profile=read(profilePath);
const physical={schema:'opensp-physical-controls',version:1,board:'sp-404mkii',source:{repository:'sp404mk2-synth',path:profilePath.replace('../sp404mk2-synth/',''),sha256:sha(profilePath)},controls:profile.controls.map(c=>({id:c.label.replaceAll('+','_').replaceAll('/','_').replaceAll(' ','_'),label:c.label,kind:c.kind,shortcut:c.kind==='pad'||c.kind==='button'}))};
fs.writeFileSync(path.join(root,'src/content/physical-controls.json'),JSON.stringify(physical,null,2)+'\n');
const registry=read('src/content/feature-registry.json');
for(const feature of registry.features)if(feature.source){const p=`../${feature.source.repository}/${feature.source.path}`;feature.source.sha256=sha(p);}
fs.writeFileSync(path.join(root,'src/content/feature-registry.json'),JSON.stringify(registry,null,2)+'\n');
const sources=[profilePath,'../sp404mk2-synth/diagnostics/synth_p6/HARDWARE_RESULT.md','../sp404mk2-synth/build/p6r-reentry-p2-package-1/manifest.json','../sp404mk2-synth/diagnostics/global_usb_stream_v552/HANDOFF.json','../sp404mk2-autotune/diagnostics/autotune_t2p/README.md','../sp404mk2-synth/diagnostics/synth_p6/full_feature_join/metadata/HANDOFF.json'];
const evidence={schema:'opensp-feature-evidence',version:1,registryRevision:registry.revision,scope:'Read-only source snapshot. No composed firmware, device access or upload.',sources:sources.map(p=>({repository:p.split('/')[1],path:p.split('/').slice(2).join('/'),sha256:sha(p)}))};
fs.writeFileSync(path.join(root,'design/penpot/feature-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(`Recorded ${physical.controls.length} named controls and ${sources.length} evidence pins.`);
