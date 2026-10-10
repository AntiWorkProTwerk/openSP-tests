"""Pinned source-only patch stage; callers supply a runner for finite fakes."""
import hashlib
from pathlib import Path
import subprocess


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_source(root, relative):
    root = Path(root).resolve()
    relative = Path(relative)
    if relative.is_absolute() or '..' in relative.parts:
        raise RuntimeError('Affected source must be a relative child path')
    path = (root / relative).resolve()
    if root not in path.parents:
        raise RuntimeError('Affected source escaped source root')
    return path


def apply_checked_patch(root, patch, patch_sha, affected, runner=None):
    if runner is None:
        runner = subprocess.run
    root, patch = Path(root).resolve(), Path(patch).resolve()
    if digest(patch.read_bytes()) != patch_sha:
        raise RuntimeError('Patch pin mismatch')
    if not affected:
        raise RuntimeError('Patch must declare affected sources')
    paths = [checked_source(root, item['path']) for item in affected]
    if len(set(paths)) != len(paths):
        raise RuntimeError('Duplicate affected source')
    for path, item in zip(paths, affected):
        if digest(path.read_bytes()) != item['beforeSha256']:
            raise RuntimeError('Before-source pin mismatch')
    base = ['git', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'apply']
    runner(base + ['--check', str(patch)], cwd=root, check=True)
    runner(base + [str(patch)], cwd=root, check=True)
    for path, item in zip(paths, affected):
        if digest(path.read_bytes()) != item['afterSha256']:
            raise RuntimeError('After-source pin mismatch')
    return {'patchSha256': patch_sha, 'affectedSources': affected, 'applicationCount': 1}
