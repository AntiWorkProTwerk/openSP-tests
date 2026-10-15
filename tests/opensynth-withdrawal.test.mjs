import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);
const image = 'opensynth/usb/opensynth-p34-app1.bin';

test('withdrawn APP1 is absent from source and public output', async () => {
  assert.equal(existsSync(new URL(`public/${image}`, root)), false);
  assert.equal(existsSync(new URL(`dist/${image}`, root)), false);
  const buildInfo = JSON.parse(await readFile(new URL('dist/build-info.json', root), 'utf8'));
  assert.equal(Object.hasOwn(buildInfo, 'opensynthStockUsb'), false);
});

test('release page offers no installer or full-image download', async () => {
  const html = await readFile(new URL('dist/releases/synth/index.html', root), 'utf8');
  assert.match(html, /The installer is temporarily unavailable while release artifacts are reviewed/);
  assert.doesNotMatch(html, /data-(?:direct-usb|usb-installer|patcher|stock-app1-url)/);
  assert.doesNotMatch(html, /opensynth-p34-app1\.bin/);
  assert.doesNotMatch(html, /Connect SP and install OpenSynth/);
});
