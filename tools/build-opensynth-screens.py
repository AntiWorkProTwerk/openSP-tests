"""Build the openSynth page's OLED screen animations from rendered frames.

The frames come from tools/opensynth-render/render.py, which compiles OpenSP's own
openSynth display code with the real voice DSP and writes native 128x64 1-bit PNGs to
design/assets/screens/opensynth/frames/ (with SOURCES.json pinning the display
sources). No Roland firmware, stock screen or logo is read. Each animation becomes
one vertical 128x(64*n) sprite strip under public/opensynth/screens/, a 4x
first-frame Penpot poster under design/assets/screens/opensynth/ and one entry in
src/content/releases/opensynth-screens.json.

Usage:
  python tools/opensynth-render/render.py --source-root PATH_TO_SP404MK2_CHECKOUT
  python tools/build-opensynth-screens.py
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

W, H = 128, 64
FRAMES = 'design/assets/screens/opensynth/frames/'


def seq(prefix, durations):
    return [(f'{FRAMES}{prefix}-{i + 1}.png', ms) for i, ms in enumerate(durations)]


ANIMATIONS = [
    {'id': 'scope', 'title': 'Scope', 'caption': 'Slow Pad: the scope keeps drawing the release tail until the note fades out.',
     'frames': seq('scope', [900, 450, 450, 450, 450, 900])},
    {'id': 'amp', 'title': 'AMP envelope', 'caption': 'The ADSR picture follows the newest note from attack to release.',
     'frames': seq('amp', [700, 700, 900, 900])},
    {'id': 'detune', 'title': 'Detune', 'caption': 'Soft Sine: with DETUNE up, the two oscillator waves drift past each other.',
     'frames': seq('detune', [140] * 6)},
    {'id': 'mix', 'title': 'MIX', 'caption': 'Soft Organ: the slider moves from oscillator A to B at 0, 50 and 100.',
     'frames': seq('mix', [900, 900, 900])},
    {'id': 'pw', 'title': 'Pulse width', 'caption': 'Acid Pulse: PW sets the pulse from 10 to 90 percent.',
     'frames': seq('pw', [800, 800, 800])},
    {'id': 'pw-lock', 'title': 'PW locked', 'caption': 'Soft Sine, Warm Triangle and Wide Saw have no pulse oscillator, so PW is greyed out and shows --.',
     'frames': seq('pwlock', [1200, 1200, 1200])},
    # One animation per feature row on /releases/synth/ (the rows name these IDs in synth.json).
    {'id': 'sounds', 'title': 'Sixteen sounds', 'caption': 'Soft Sine, Wide Saw as a chord, Acid Pulse, Slow Pad, Soft Organ and Sub Bass, each played on the pads.',
     'frames': seq('sounds', [1100] * 6)},
    {'id': 'pages', 'title': 'Pages', 'caption': 'Wide Saw with a chord held: TONE, OSC, AMP and MOD, each with its own picture and knob values.',
     'frames': seq('pages', [1300] * 4)},
    {'id': 'mix-pw', 'title': 'MIX and PW', 'caption': 'MIX at 0, 50 and 100 on Soft Organ, PW at 10, 50 and 90 percent on Acid Pulse, then PW greyed out on Soft Sine, Warm Triangle and Wide Saw.',
     'frames': seq('mix', [900, 900, 900]) + seq('pw', [800, 800, 800]) + seq('pwlock', [1100, 1100, 1100])},
    {'id': 'voice', 'title': 'MONO or POLY', 'caption': 'The same three-pad chord on Wide Saw: POLY4 plays three voices, MONO plays one.',
     'frames': seq('voice', [1600, 1600])},
    {'id': 'level', 'title': 'Synth level', 'caption': 'SHIFT + VALUE: the bottom line shows VOL and a bar while you turn, with a tick at the default level.',
     'frames': seq('level', [1200, 450, 450, 800, 450, 450, 1200])},
    {'id': 'velocity', 'title': 'Fixed velocity', 'caption': 'Pluck played on four pads in turn. Synth notes have no velocity, so this screen looks the same with fixed velocity on or off.',
     'frames': seq('velocity', [600, 600, 600, 900, 1200])},
    {'id': 'patterns', 'title': 'Patterns', 'caption': 'The pattern chooser: A03 starts, A06 waits as the next pattern, then the pads play Wide Saw over it.',
     'frames': seq('patterns', [1300, 1300, 1500, 1600])},
    {'id': 'record', 'title': 'Record to a pad', 'caption': 'REC asks for an empty pad, pad 3 is armed, the frame count rises while you play, then SAVED.',
     'frames': seq('record', [1400, 1400, 600, 600, 1000, 1600])},
]


def native(path: Path) -> Image.Image:
    """Return the 128x64 1-bit frame; require an exact integer pixel zoom."""
    image = Image.open(path).convert('L')
    zoom = image.width // W
    if image.size != (W * zoom, H * zoom) or zoom < 1:
        raise SystemExit(f'{path}: unexpected size {image.size}')
    small = image.resize((W, H), Image.NEAREST)
    if zoom > 1 and small.resize(image.size, Image.NEAREST).tobytes() != image.tobytes():
        raise SystemExit(f'{path}: not an exact {zoom}x pixel zoom')
    return small.point(lambda v: 255 if v >= 128 else 0).convert('1')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='.')
    args = parser.parse_args()
    root = out = Path(args.out)
    pins = json.loads((root / FRAMES / 'SOURCES.json').read_text(encoding='utf-8'))
    sprites = out / 'public/opensynth/screens'
    sprites.mkdir(parents=True, exist_ok=True)
    manifest = {'schema': 1, 'width': W, 'height': H,
                'provenance': 'Host renders of the openSynth display code (OpenSP source) by tools/opensynth-render; not device captures, and frame timing is set for the page. No Roland firmware, stock screens or logos.',
                'display_sources': pins,
                'animations': []}
    for anim in ANIMATIONS:
        frames = [native(root / name) for name, _ in anim['frames']]
        strip = Image.new('1', (W, H * len(frames)))
        for i, frame in enumerate(frames):
            strip.paste(frame, (0, i * H))
        target = sprites / f"{anim['id']}.png"
        strip.save(target, optimize=True)
        posters = out / 'design/assets/screens/opensynth'
        posters.mkdir(parents=True, exist_ok=True)
        frames[0].resize((W * 4, H * 4), Image.NEAREST).save(posters / f"{anim['id']}-poster.png", optimize=True)
        manifest['animations'].append({
            'id': anim['id'], 'title': anim['title'], 'caption': anim['caption'],
            'src': f"/opensynth/screens/{anim['id']}.png", 'frames': len(frames),
            'durations': [ms for _, ms in anim['frames']],
            'sprite_sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
            'sources': [{'path': name, 'sha256': hashlib.sha256((root / name).read_bytes()).hexdigest()} for name, _ in anim['frames']],
        })
    (out / 'src/content/releases/opensynth-screens.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print({'animations': len(manifest['animations']), 'frames': sum(a['frames'] for a in manifest['animations'])})


if __name__ == '__main__':
    main()
