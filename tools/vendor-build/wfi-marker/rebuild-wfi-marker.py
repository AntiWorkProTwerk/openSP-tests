#!/usr/bin/env python3
"""Private fresh ARM/WFI candidate builder. Native invocation is separately gated."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys

MANIFEST_SHA256 = 'db347e4557ad444097ae44be86bcac6d7adea006f577b88386eba70079029a81'
STAGING_SHA256 = '32f3863432a3fdcf725373ea1f42c504d37e844dda0244514d3fa001485f0c95'
COMPOSITION = 'temp-lifetime-it-hook-stop-xpsr-hflags-m7-host-registers-wfi-marker'
BUNDLE = Path(__file__).resolve().parent
WEBSITE_PROJECT = BUNDLE.parents[2]
BUILD_FLAGS = {
    "'-s', 'SINGLE_FILE=1',": "'-s', 'SINGLE_FILE=0',\n        '-s', 'EXPORT_ES6=1',",
    'jobs = os.cpu_count() or 1': 'jobs = min(8, os.cpu_count() or 1)',
    "f'dist/unicorn{suffix}.js'": "'dist/unicorn-arm.js'",
    "'-DCMAKE_BUILD_TYPE=Release',": "'-DCMAKE_BUILD_TYPE=Release',\n        '-DCMAKE_C_FLAGS=-ffile-prefix-map=' + ROOT_DIR + '=unicorn.js',",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pinned(path, expected):
    data = Path(path).read_bytes()
    if sha(data) != expected:
        raise RuntimeError('Private bundle/source pin mismatch')
    return data


def validate_paths(workdir, output, repository_root=WEBSITE_PROJECT):
    source, destination = Path(workdir), Path(output)
    if not source.is_absolute() or not destination.is_absolute():
        raise ValueError('Source and output must be explicit absolute paths')
    source, destination, repository_root = source.resolve(), destination.resolve(), Path(repository_root).resolve()
    if source.exists() or destination.exists():
        raise ValueError('Source and output must both be absent')
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError('Source and output must be separate nonnested paths')
    for path in (source, destination):
        if path == repository_root or repository_root in path.parents:
            raise ValueError('Fresh build source and output must be outside the repository')
    return source, destination


def bundle_manifest():
    manifest = json.loads(pinned(BUNDLE / 'staging-manifest.json', MANIFEST_SHA256))
    pinned(BUNDLE / 'staging.py', STAGING_SHA256)
    pinned(BUNDLE / 'before/rebuild-unicorn.py', manifest['canonicalDriverSha256'])
    pinned(BUNDLE / 'before/upstream-build.py', manifest['upstreamBuildBeforeSha256'])
    pinned(BUNDLE / 'patches/marker-wrapper.patch', manifest['wrapperPatch']['sha256'])
    for item in manifest['innerRepairs']:
        pinned(BUNDLE / item['patch'], item['sha256'])
    return manifest


def export_transform(upstream, manifest):
    if sha(upstream) != manifest['upstreamBuildBeforeSha256']:
        raise RuntimeError('Clean upstream build.py pin mismatch')
    needle = b"    '_uc_emu_start',"
    if upstream.count(needle) != 1:
        raise RuntimeError('Expected exactly one upstream export boundary')
    result = upstream.replace(needle, b"    '_uc_arm_wfi_event_field',\n" + needle)
    if sha(result) != manifest['upstreamBuildAfterExportSha256']:
        raise RuntimeError('After-export build.py pin mismatch')
    return result.decode()


def derive_build_script(upstream, manifest):
    result = export_transform(upstream, manifest)
    for old, new in BUILD_FLAGS.items():
        if result.count(old) != 1:
            raise RuntimeError('Canonical build flag boundary mismatch')
        result = result.replace(old, new)
    marker = '    patchUnicorn()\n'
    if result.count(marker) != 1:
        raise RuntimeError('Expected one upstream transformation stage')
    invocation = marker + "    import hashlib, importlib.util, json\n"
    invocation += "    stage_path = os.path.join(ROOT_DIR, 'opensp-wfi-staging.py')\n"
    invocation += "    with open(stage_path, 'rb') as stream:\n        stage_sha = hashlib.sha256(stream.read()).hexdigest()\n"
    invocation += "    if stage_sha != " + repr(STAGING_SHA256) + ":\n        raise RuntimeError('Staging helper pin mismatch')\n"
    invocation += "    spec = importlib.util.spec_from_file_location('opensp_private_wfi_stage', stage_path)\n"
    invocation += "    stage = importlib.util.module_from_spec(spec)\n    spec.loader.exec_module(stage)\n    receipts = []\n"
    for index, item in enumerate(manifest['innerRepairs']):
        name = f"opensp-inner-{index}-{item['name']}.patch"
        invocation += "    receipt = stage.apply_checked_patch(UNICORN_DIR, os.path.join(ROOT_DIR, " + repr(name) + "), " + repr(item['sha256']) + ", " + repr(item['affectedSources']) + ")\n"
        invocation += "    receipts.append({'name': " + repr(item['name']) + ", **receipt})\n"
    invocation += "    with open(os.path.join(ROOT_DIR, 'opensp-wfi-stage-receipts.json'), 'w') as stream:\n        json.dump(receipts, stream, indent=2)\n"
    return result.replace(marker, invocation)


def load_stage():
    pinned(BUNDLE / 'staging.py', STAGING_SHA256)
    spec = importlib.util.spec_from_file_location('opensp_private_stage_driver', BUNDLE / 'staging.py')
    stage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(stage)
    return stage


def reject_private_artifacts(contents, prefixes):
    for name in ('unicorn-arm.js', 'unicorn-arm.wasm'):
        if any(str(prefix).encode() in contents[name] for prefix in prefixes if str(prefix)):
            raise RuntimeError('Private build prefix embedded; no output copied')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workdir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source, output = validate_paths(args.workdir, args.output)
    manifest = bundle_manifest()
    stage = load_stage()
    # The caller must retain raw subprocess logs outside public/git evidence.
    subprocess.run(['git', 'clone', manifest['repository'], str(source)], check=True)
    subprocess.run(['git', 'checkout', '--detach', manifest['wrapperCommit']], cwd=source, check=True)
    subprocess.run(['git', 'submodule', 'update', '--init'], cwd=source, check=True)
    actual_core = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source / 'unicorn', text=True).strip()
    if actual_core != manifest['coreCommit']:
        raise RuntimeError('Core revision mismatch')
    compiler = subprocess.check_output(['emcc', '--version'], text=True).splitlines()[0]
    if ' ' + manifest['emscripten'] + ' ' not in compiler + ' ':
        raise RuntimeError('Pinned compiler required')
    upstream = subprocess.check_output(['git', 'show', manifest['wrapperCommit'] + ':build.py'], cwd=source)
    generated = derive_build_script(upstream, manifest)
    # Both outer stages complete before executing the generated build driver.
    wrapper = manifest['wrapper']
    outer = stage.apply_checked_patch(source, BUNDLE / manifest['wrapperPatch']['path'],
      manifest['wrapperPatch']['sha256'], [wrapper])
    (source / 'build.py').write_bytes(generated.encode('utf-8'))
    shutil.copyfile(BUNDLE / 'staging.py', source / 'opensp-wfi-staging.py')
    for index, item in enumerate(manifest['innerRepairs']):
        shutil.copyfile(BUNDLE / item['patch'], source / f"opensp-inner-{index}-{item['name']}.patch")
    generated_sha = sha((source / 'build.py').read_bytes())
    if generated_sha != sha(generated.encode()):
        raise RuntimeError('Generated script changed before execution')
    subprocess.run([sys.executable, 'build.py', 'arm'], cwd=source, check=True)
    receipts = json.loads((source / 'opensp-wfi-stage-receipts.json').read_text())
    if [item['name'] for item in receipts] != [item['name'] for item in manifest['innerRepairs']]:
        raise RuntimeError('Inner stage order mismatch')
    final_sources = {}
    for item in manifest['innerRepairs']:
        for affected in item['affectedSources']:
            final_sources[affected['path']] = affected['afterSha256']
    for relative, expected in final_sources.items():
        pinned(source / 'unicorn' / relative, expected)
    pinned(source / wrapper['path'], wrapper['afterSha256'])
    canonical = runpy.run_path(str(BUNDLE / 'before/rebuild-unicorn.py'), run_name='private_metadata_helpers')
    upstream_source = canonical['upstream_build_source'](source)
    names = {'unicorn-arm.js': 'dist/unicorn-arm.js', 'unicorn-arm.wasm': 'dist/unicorn-arm.wasm',
      'LICENSE-GPL-2.0.txt': 'LICENSE', 'UNICORN-COPYING.txt': 'unicorn/COPYING',
      'UNICORN-AUTHORS.txt': 'unicorn/AUTHORS.TXT', 'UNICORN-CREDITS.txt': 'unicorn/CREDITS.TXT'}
    contents = {name: (source / relative).read_bytes() for name, relative in names.items()}
    reject_private_artifacts(contents, [source, Path.home(), BUNDLE, WEBSITE_PROJECT])
    # A racing owner cannot cause an existing output directory to be overwritten.
    output.mkdir(parents=True, exist_ok=False)
    report = {'repository': manifest['repository'], 'wrapperCommit': manifest['wrapperCommit'],
      'coreCommit': manifest['coreCommit'], 'emscripten': manifest['emscripten'], 'compiler': compiler,
      'architecture': 'arm', 'license': 'GPL-2.0', 'composition': COMPOSITION,
      'sourceDirectoryWasAbsent': True, 'outputDirectoryWasAbsent': True,
      'upstreamBuildSource': upstream_source,
      'upstreamBuildBeforeSha256': manifest['upstreamBuildBeforeSha256'],
      'upstreamBuildAfterExportSha256': manifest['upstreamBuildAfterExportSha256'],
      'generatedBuildScriptSha256': generated_sha,
      'manifestSha256': MANIFEST_SHA256, 'stagingModuleSha256': STAGING_SHA256,
      'outerWrapperStage': outer, 'innerStages': receipts, 'files': {}}
    for name, data in contents.items():
        (output / name).write_bytes(data)
        report['files'][name] = {'bytes': len(data), 'sha256': sha(data)}
    (output / 'provenance.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
