"""Render the openSynth page's screen frames from the openSynth display source.

Compiles render.c with the openSynth view, controls, voice and visual sources from an
SP404MK2 checkout and writes native 128x64 1-bit PNG frames. No device access and no
Roland firmware are involved.

Usage (needs the ziglang Python package as the host C compiler):
  python tools/opensynth-render/render.py --source-root PATH_TO_SP404MK2_CHECKOUT
Then run tools/build-opensynth-screens.py to rebuild the sprites and manifest.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

MODULE = 'diagnostics/opensynth_p12_combined_build_11/final-build-001/module/source'
HOSTINC = 'diagnostics/opensynth_root_finish_09/claude-workers-009/synth_visuals_detune/hostinc'
SOURCES = ['p6/sp_p6_view.c', 'p6/sp_synth_preview_voice.c', 'p6/sp_p6_volume.c', 'p6/sp_p4_controls.c',
           'p6/sp_synth_preview_visual.c', 'p5/dsp/src/sp_synth_dsp.c',
           'p7/sp_p6_rec_modal_view.c', 'p7/sp_p6_pattern_transport_view.c']


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', required=True)
    parser.add_argument('--out', default='design/assets/screens/opensynth/frames')
    args = parser.parse_args()
    root, here, out = Path(args.source_root), Path(__file__).resolve().parent, Path(args.out)
    module = root / MODULE
    inc = ['-I', module / 'p6', '-I', root / HOSTINC]
    for d in [module / 'p6/demo/firmware', module / 'p7', *sorted(p for p in module.rglob('include') if p.is_dir() and 'recorder' not in p.parts)]:
        inc += ['-I', d]
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        exe, bins = Path(tmp) / 'render.exe', Path(tmp) / 'bin'
        bins.mkdir()
        cmd = [sys.executable, '-m', 'ziglang', 'cc', '-O1', '-std=c11', *inc, here / 'render.c', *[module / s for s in SOURCES], '-o', exe]
        subprocess.run([str(c) for c in cmd], check=True)
        subprocess.run([str(exe), str(bins)], check=True, capture_output=True)
        for p in sorted(bins.glob('*.bin')):
            data = p.read_bytes()
            assert len(data) == 1024
            im = Image.new('1', (128, 64), 0)
            px = im.load()
            for y in range(64):
                for x in range(128):
                    if data[y * 16 + x // 8] & (0x80 >> (x & 7)):
                        px[x, y] = 1
            im.save(out / f'{p.stem}.png', optimize=True)
    pins = {'module': MODULE, 'sources': {s: hashlib.sha256((module / s).read_bytes()).hexdigest() for s in SOURCES},
            'harness_sha256': hashlib.sha256((here / 'render.c').read_bytes()).hexdigest()}
    (out / 'SOURCES.json').write_text(json.dumps(pins, indent=2) + '\n', encoding='utf-8')
    print({'frames': len(list(out.glob('*.png')))})


if __name__ == '__main__':
    main()
