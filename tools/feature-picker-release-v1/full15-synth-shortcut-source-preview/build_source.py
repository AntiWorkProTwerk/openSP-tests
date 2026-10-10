"""Build a selected Full15 Synth module with an optional global PC recorder.

The reviewed native source builder owns config generation and all129 fresh
compile units. This adapter emits no firmware image or device command.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json

FOLDER='diagnostics/opensynth_full15_shortcut_global_join_01'
HANDOFF_SHA='54d287a5b66c885a703deb20180d53be8fd476ed45ad7a70b97128db42563f63'
PROFILES={
 'full15-synth-shortcut-source-preview':{'optional_global':False,'module':'94fe19ce26e1685080789ab064ff521185a1bdef583bb8236c2dce5fed216a2c'},
 'full15-shortcut-optional-global-source-preview':{'optional_global':True,'module':'e85d7c108692afa2a3a7bf166457274dd195970e7d2b06f3d7de6403e56e2aa4'}}
COMPOSITION_SHA='aad987cd198604093ef1af6c2a28f4a7901693762ec212f8dd68bbd3505ae593'
DISPATCHER_PARENT_SHA='b5082b02f308c183890dd183e8184ba52c4e8203ec15e467aac1d93a3bd8567f'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def authority(root):
    root=Path(root).resolve();folder=root/FOLDER;handoff=folder/'BUILDER_HANDOFF.json'
    if sha(handoff)!=HANDOFF_SHA:raise ValueError('Use the exact reviewed Full15 optional-global source builder')
    receipt=json.loads(handoff.read_text(encoding='utf-8'))
    for row in receipt['artifacts'].values():
        path=(folder/row['path']).resolve()
        if not path.is_relative_to(folder) or sha(path)!=row['sha256']:raise ValueError('Combined source input changed: '+row['path'])
    if sha(folder/'SOURCE_COMPOSITION.json')!=COMPOSITION_SHA:raise ValueError('Combined composition changed')
    spec=importlib.util.spec_from_file_location('reviewed_full15_combined_source_builder',folder/'build_source.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.authority()
    return module
def build(root,profile,selection_sha,shortcut_path,official,output,tool_prefix):
    root=Path(root).resolve();output=Path(output).resolve();pins=PROFILES[profile]
    module=authority(root)
    report=module.build(root,selection_sha,shortcut_path,official,output,tool_prefix,optional_global=pins['optional_global'],workers=8)
    config=json.loads((output/report['config']['path']).read_text(encoding='utf-8'))
    if config['optional_global'] is not pins['optional_global'] or config['feature_mask']!=(3 if pins['optional_global'] else 1) or config['recorder_controls_mask']!=0 or config['recorder_trigger']!=0 or config['native_setter_executed'] is not False:raise ValueError('Unsupported recorder config or source variant')
    if sha(output/'module/source/dispatcher/generated_config.c')!=config['generated_source_sha256']:raise ValueError('Compiled config source changed')
    if report['APP1_emitted'] is not False or report['device_operations'] is not False or report['native_route_qualified'] is not False or report['inherited_object_count']!=0 or report['fresh_object_count']!=129:raise ValueError('Unexpected source build scope')
    report['source_preview'].update(profile=profile,reference_module={'sha256':pins['module']},source_successor_sha256=DISPATCHER_PARENT_SHA,source_composition_sha256=COMPOSITION_SHA,combined_builder_handoff_sha256=HANDOFF_SHA,firmware_build_admitted=False,config=config)
    (output/'REPORT.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('sp-root','shortcut','official','output','tool-prefix'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--profile',choices=tuple(PROFILES),required=True)
    parser.add_argument('--selection-sha',required=True)
    args=parser.parse_args();result=build(args.sp_root,args.profile,args.selection_sha,args.shortcut,args.official,args.output,args.tool_prefix)
    print(json.dumps({'status':result['status'],'module':result['module'],'source_preview':result['source_preview']},indent=2))
if __name__=='__main__':main()
