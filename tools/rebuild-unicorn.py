#!/usr/bin/env python3
"""Rebuild the pinned ARM browser CPU. Requires Emscripten 5.0.5 on PATH."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

WRAPPER_COMMIT = '1220477c7fb0f8fe4b500f4bd211de52f6dfe638'
CORE_COMMIT = '8028ec436f2d9376525352dd38ed9ed6b9f6be10'
EMSCRIPTEN_VERSION = '5.0.5'
REPOSITORY = 'https://github.com/AlexAltea/unicorn.js'
CANDIDATE_REPAIRS = {
    'temp-lifetime': {
        'path': 'tools/vendor-patches/unicorn-arm-temp-lifetime.patch',
        'affectedPath': 'qemu/tcg/tcg.c',
        'sha256': '8f179f1cf100a1246bfbe5b5c4993f025b79ad614aa0b01c22df6589fc186fd3',
        'beforeSha256': 'fedab0cdaf17c3f7a27fb49a14e6847c08e8cf6b436ce474a39e3f58ef7ef1b4',
        'afterSha256': '2e705fd88b03c1a13ff38f7341e442eed1421d9380ed49b6eff7361b265aad31',
    },
    'conditional-hook-stop': {
        'path': 'tools/vendor-patches/unicorn-arm-conditional-hook-stop.patch',
        'affectedPath': 'qemu/target/arm/translate.c',
        'sha256': '5c666cd6b7cab4d0404f47cf2c3ea49b0b102cba44b23af03b1c288cccd4dc31',
        'beforeSha256': '22102563894df046a957f7b80e2ecd385f7e4829584fa1b22e01a52d59fde53a',
        'afterSha256': 'cfa7819d862daac859aa282a67e0f24164a48171c52e4a15305e101d872e2674',
    },
    'host-xpsr-hflags': {
        'path': 'tools/vendor-patches/unicorn-arm-xpsr-hflags.patch',
        'affectedPath': 'qemu/target/arm/unicorn_arm.c',
        'sha256': 'cff39b686f1dfc106f9aa17ea484babe020be8d7aa45a9fbbb4cf43549410423',
        'beforeSha256': '20f98c8a80ab2ca4b5af2904df03d14e0a2c659c4dc0608b3789166a8812b730',
        'afterSha256': '60a0341b7f29f49501e4597912130560717d6d0852bb26baf1eb0cf5cf7ada40',
        'upstreamCommit': 'fd081bce930363e187a46a1c43c53ece19b1dc29',
        'upstreamURL': 'https://github.com/unicorn-engine/unicorn/commit/fd081bce930363e187a46a1c43c53ece19b1dc29',
    },
    'm7-host-registers': {
        'path': 'tools/vendor-patches/unicorn-arm-m7-host-registers.patch',
        'sha256': 'ce12796247de53c6e39d937fbdb65af3e949e1b1f20be448c651ae45404e161c',
        'affectedSources': [
            {'path': 'qemu/target/arm/unicorn_arm.c',
             'beforeSha256': '60a0341b7f29f49501e4597912130560717d6d0852bb26baf1eb0cf5cf7ada40',
             'afterSha256': '465773a48469cab471a4de6d8f4399696c5ce325eadb7dbb3cd4535148d26a75'},
            {'path': 'qemu/target/arm/m_helper.c',
             'beforeSha256': '019fb1cf4bd7fb64addea8717cac2f2cd393375839df7c71e17b94af54f6d332',
             'afterSha256': 'ac641645a247cbfb1d22b60560e195209cfe6ff9762fa2c103687a74f98e8ccd'},
        ],
    },
}
CANDIDATE_COMPOSITIONS = {
    'temp-lifetime-it-hook-stop': ['temp-lifetime', 'conditional-hook-stop'],
    'temp-lifetime-it-hook-stop-xpsr-hflags': ['temp-lifetime', 'conditional-hook-stop', 'host-xpsr-hflags'],
    'temp-lifetime-it-hook-stop-xpsr-hflags-m7-host-registers': [
        'temp-lifetime', 'conditional-hook-stop', 'host-xpsr-hflags', 'm7-host-registers'],
}

def affected_sources(repair):
    """Keep historical single-source metadata while admitting pinned compositions."""
    return repair.get('affectedSources', [{'path': repair.get('affectedPath'),
        'beforeSha256': repair.get('beforeSha256'), 'afterSha256': repair.get('afterSha256')}])

def run(args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)

def upstream_build_source(source):
    def file(path):
        contents = subprocess.check_output(['git', 'show', f'{WRAPPER_COMMIT}:{path}'], cwd=source)
        return {'path': path,
            'url': f'https://raw.githubusercontent.com/AlexAltea/unicorn.js/{WRAPPER_COMMIT}/{path}',
            'sha256': hashlib.sha256(contents).hexdigest()}
    tree = 'externals/qemu-5.0.1'
    tree_sha = subprocess.check_output(['git', 'rev-parse', f'{WRAPPER_COMMIT}:{tree}'],
        cwd=source, text=True).strip()
    return {
        'driver': file('build.py'),
        'transformations': [
            {'operation': 'copy missing files', 'source': {
                'path': tree,
                'url': f'https://github.com/AlexAltea/unicorn.js/tree/{WRAPPER_COMMIT}/{tree}',
                'gitTreeSha1': tree_sha}, 'destination': 'unicorn/qemu'},
            {'operation': 'apply patch', 'source': file('src/patches/unicorn-tci.patch')},
            {'operation': 'copy if missing', 'source': file('src/qemu/helper-adapter.h'),
                'destination': 'unicorn/qemu/include/exec/helper-adapter.h'},
            {'operation': 'apply patch', 'source': file('src/patches/unicorn-adapters.patch')},
            {'operation': 'apply patch', 'source': file('src/patches/unicorn-ppc-fix.patch')},
            {'operation': 'regenerate symbol aliases', 'command': ['bash', 'symbols.sh'],
                'workingDirectory': 'unicorn'},
        ],
    }

def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workdir', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--candidate-repair', choices=['temp-lifetime'],
        help='Apply one optional repair in a fresh source checkout; requires explicit nonpublic output')
    selection.add_argument('--candidate-composition', choices=CANDIDATE_COMPOSITIONS,
        help='Apply an ordered repair composition in fresh source; requires explicit nonpublic output')
    args = parser.parse_args(argv)
    project = Path(__file__).resolve().parents[1]
    args.workdir = args.workdir.resolve()
    if args.candidate_repair or args.candidate_composition:
        if args.workdir.exists():
            parser.error('Candidate repair requires an absent source directory')
        if args.output is None:
            parser.error('Candidate repair requires explicit --output')
        output = args.output.resolve()
        public = (project / 'public').resolve()
        if output == public or public in output.parents:
            parser.error('Candidate repair output must be outside public/')
        if output.exists():
            parser.error('Candidate repair requires an absent output directory to preserve evidence')
    args.output = (args.output or project / 'public/emulator/vendor').resolve()
    return args


def main():
    args = parse_args()
    source = args.workdir
    output = args.output
    repair_names = CANDIDATE_COMPOSITIONS.get(args.candidate_composition,
        [args.candidate_repair] if args.candidate_repair else [])
    repairs = {name: CANDIDATE_REPAIRS[name] for name in repair_names}
    repair_bytes = {}
    for name, repair in repairs.items():
        repair_bytes[name] = (Path(__file__).resolve().parents[1] / repair['path']).read_bytes()
        if hashlib.sha256(repair_bytes[name]).hexdigest() != repair['sha256']:
            raise RuntimeError('Candidate repair patch hash mismatch')
    if not (source / '.git').exists():
        source.parent.mkdir(parents=True, exist_ok=True)
        run(['git', 'clone', REPOSITORY, str(source)])
    run(['git', 'fetch', 'origin', WRAPPER_COMMIT], source)
    run(['git', 'checkout', '--detach', WRAPPER_COMMIT], source)
    run(['git', 'submodule', 'update', '--init'], source)
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source / 'unicorn', text=True).strip()
    if actual != CORE_COMMIT:
        raise RuntimeError(f'Unexpected Unicorn core: {actual}')
    version = subprocess.check_output(['emcc', '--version'], text=True).splitlines()[0]
    if f' {EMSCRIPTEN_VERSION} ' not in version + ' ':
        raise RuntimeError(f'Requires Emscripten {EMSCRIPTEN_VERSION}; found {version}')
    # Restore only this build source before applying the documented build flags.
    original = subprocess.check_output(['git', 'show', f'{WRAPPER_COMMIT}:build.py'], cwd=source, text=True)
    upstream_source = upstream_build_source(source)
    patches = {
        "'-s', 'SINGLE_FILE=1',": "'-s', 'SINGLE_FILE=0',\n        '-s', 'EXPORT_ES6=1',",
        "jobs = os.cpu_count() or 1": "jobs = min(8, os.cpu_count() or 1)",
        "f'dist/unicorn{suffix}.js'": "'dist/unicorn-arm.js'",
        "'-DCMAKE_BUILD_TYPE=Release',": "'-DCMAKE_BUILD_TYPE=Release',\n        '-DCMAKE_C_FLAGS=-ffile-prefix-map=' + ROOT_DIR + '=unicorn.js',",
    }
    modified = original
    for before, after in patches.items():
        if modified.count(before) != 1:
            raise RuntimeError(f'Upstream build patch mismatch: {before}')
        modified = modified.replace(before, after)
    if repairs:
        marker = '    patchUnicorn()\n'
        if modified.count(marker) != 1:
            raise RuntimeError('Expected one upstream transformation invocation')
        invocation = marker + '    import hashlib\n'
        for name, repair in repairs.items():
            patch_name = f'opensp-local-{name}.patch'
            (source / patch_name).write_bytes(repair_bytes[name])
            for affected in affected_sources(repair):
                invocation += (
            f'    repair_source = os.path.join(UNICORN_DIR, {affected["path"]!r})\n'
            '    with open(repair_source, "rb") as repair_stream:\n'
            '        repair_before_sha = hashlib.sha256(repair_stream.read()).hexdigest()\n'
            f'    if repair_before_sha != {affected["beforeSha256"]!r}:\n'
            '        raise RuntimeError("Unexpected transformed source before candidate repair")\n'
                )
            invocation += (
            f'    repair_patch = os.path.join(ROOT_DIR, {patch_name!r})\n'
            '    subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "core.eol=lf", "apply", "--check", repair_patch], cwd=UNICORN_DIR, check=True)\n'
            '    subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "core.eol=lf", "apply", repair_patch], cwd=UNICORN_DIR, check=True)\n'
            )
            for affected in affected_sources(repair):
                invocation += (
            f'    repair_source = os.path.join(UNICORN_DIR, {affected["path"]!r})\n'
            '    with open(repair_source, "rb") as repair_stream:\n'
            '        repair_after_sha = hashlib.sha256(repair_stream.read()).hexdigest()\n'
            f'    if repair_after_sha != {affected["afterSha256"]!r}:\n'
            '        raise RuntimeError("Unexpected transformed source after candidate repair")\n'
                )
            upstream_source['transformations'].append({
            'operation': 'apply optional candidate patch',
            'source': {'path': repair['path'], 'bytes': len(repair_bytes[name]), 'sha256': repair['sha256'],
                **{key: repair[key] for key in ('upstreamCommit', 'upstreamURL') if key in repair}},
            'workingDirectory': 'unicorn',
            'order': 'After all upstream transformations and before constants generation or compilation',
            'applicationCount': 1,
            })
        modified = modified.replace(marker, invocation)
    (source / 'build.py').write_text(modified)
    run([os.sys.executable, 'build.py', 'arm'], source)
    final_sources = {affected['path']: affected['afterSha256']
        for repair in repairs.values() for affected in affected_sources(repair)}
    for path, expected in final_sources.items():
        actual_repaired_sha = hashlib.sha256((source / 'unicorn' / path).read_bytes()).hexdigest()
        if actual_repaired_sha != expected:
            raise RuntimeError('Candidate repaired source hash mismatch; output was not copied')
    output.mkdir(parents=True, exist_ok=True)
    files = {
        'unicorn-arm.js': source / 'dist/unicorn-arm.js',
        'unicorn-arm.wasm': source / 'dist/unicorn-arm.wasm',
        'LICENSE-GPL-2.0.txt': source / 'LICENSE',
        'UNICORN-COPYING.txt': source / 'unicorn/COPYING',
        'UNICORN-AUTHORS.txt': source / 'unicorn/AUTHORS.TXT',
        'UNICORN-CREDITS.txt': source / 'unicorn/CREDITS.TXT',
    }
    report = {
        'repository': REPOSITORY,
        'wrapperCommit': WRAPPER_COMMIT,
        'coreRepository': 'https://github.com/unicorn-engine/unicorn',
        'coreCommit': CORE_COMMIT,
        'coreCommitRole': 'Base revision before the upstream wrapper source transformations',
        'upstreamBuildSource': upstream_source,
        'emscripten': EMSCRIPTEN_VERSION,
        'license': 'GPL-2.0',
        'architecture': 'arm',
        'buildChanges': ['Separate WASM', 'ES module export', 'At most eight parallel build jobs',
            'Map build directory to unicorn.js in embedded source names'],
        'files': {},
    }
    repair_reports = []
    for name, repair in repairs.items():
        report['buildChanges'].append('Release wasm32 TCI narrow-argument scratch temporaries after call emission'
            if name == 'temp-lifetime' else 'Publish current Thumb PC/IT and honor code-hook stops through metadata restoration'
            if name == 'conditional-hook-stop' else 'Rebuild cached ARM state after host XPSR-family writes (official fd081bce)'
            if name == 'host-xpsr-hflags' else 'Separate live M7 raw host registers from architected guest and context access')
        repair_reports.append({
            'name': name,
            'source': {'path': repair['path'], 'bytes': len(repair_bytes[name]), 'sha256': repair['sha256'],
                **{key: repair[key] for key in ('upstreamCommit', 'upstreamURL') if key in repair}},
            **({'affectedSources': affected_sources(repair)} if 'affectedSources' in repair else
                {'affectedSource': affected_sources(repair)[0]}),
            'applicationCount': 1,
            'sourceDirectoryWasAbsent': True,
            'outputDirectoryWasAbsent': True,
            'order': 'After all upstream transformations and before constants generation or compilation',
        })
    if args.candidate_repair:
        report['candidateRepair'] = repair_reports[0]
    if args.candidate_composition:
        report['candidateComposition'] = {'name': args.candidate_composition, 'repairs': repair_reports,
            'sourceDirectoryWasAbsent': True, 'outputDirectoryWasAbsent': True}
    contents_by_name = {name: path.read_bytes() for name, path in files.items()}
    private_prefixes = [str(source), str(Path.home())]
    for name in ('unicorn-arm.js', 'unicorn-arm.wasm'):
        if any(prefix.encode() in contents_by_name[name] for prefix in private_prefixes):
            raise RuntimeError(f'Private build directory embedded in {name}; output was not copied')
    for name, contents in contents_by_name.items():
        (output / name).write_bytes(contents)
        report['files'][name] = {'bytes': len(contents), 'sha256': hashlib.sha256(contents).hexdigest()}
    (output / 'provenance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
