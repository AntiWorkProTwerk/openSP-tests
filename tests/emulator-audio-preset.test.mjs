import test from 'node:test';
import assert from 'node:assert/strict';
import {STOCK_AUDIO_PRESET, STOCK_V552_SILENT_FIXTURES, resolveAudioFixtures, validateAudioPreset} from '../src/lib/emulator/audio-preset.ts';

const stock = Object.freeze({format: 'app1', sha256: '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80'});
const explicit = () => ({saiClockReady: false, externalClock: false, slotTicks: 17,
  rxFrame: Object.freeze(Array.from({length: 16}, (_, n) => n + 1))});

test('the selected exact stock APP1 resolves only to the declared silent fixture', () => {
  assert.equal(STOCK_AUDIO_PRESET, 'stock-v552-silent');
  assert.equal(resolveAudioFixtures(stock, undefined, STOCK_AUDIO_PRESET), STOCK_V552_SILENT_FIXTURES);
  assert.deepEqual(STOCK_V552_SILENT_FIXTURES.rxFrame, Array(16).fill(0));
  assert.equal(STOCK_V552_SILENT_FIXTURES.externalClock, true);
  assert.ok(Number.isSafeInteger(STOCK_V552_SILENT_FIXTURES.slotTicks) && STOCK_V552_SILENT_FIXTURES.slotTicks >= 1);
  assert.ok(Object.isFrozen(STOCK_V552_SILENT_FIXTURES));
  assert.ok(Object.isFrozen(STOCK_V552_SILENT_FIXTURES.rxFrame));
});

test('the known stock identity leaves audio absent unless the preset is explicitly selected', () => {
  assert.equal(resolveAudioFixtures(stock), undefined);
  assert.equal(validateAudioPreset(undefined), undefined);
  assert.equal(validateAudioPreset(STOCK_AUDIO_PRESET), STOCK_AUDIO_PRESET);
});

test('full flash and every nonexact APP1 identity leave the selected preset absent', () => {
  for (const image of [{...stock, format: 'flash'}, {...stock, sha256: 'a'.repeat(64)},
    {...stock, sha256: stock.sha256.toUpperCase()}, {...stock, sha256: stock.sha256 + ' '},
    {...stock, sha256: stock.sha256.slice(1)}, {...stock, sha256: ''}])
    assert.equal(resolveAudioFixtures(image, undefined, STOCK_AUDIO_PRESET), undefined);
});

test('explicit fixtures retain priority for stock, other APP1 and full-flash images', () => {
  const fixture = explicit();
  for (const image of [stock, {...stock, sha256: 'b'.repeat(64)}, {...stock, format: 'flash'}]) {
    assert.equal(resolveAudioFixtures(image, fixture, STOCK_AUDIO_PRESET), fixture);
    assert.equal(resolveAudioFixtures(image, fixture), fixture);
  }
});

test('invalid preset values fail even when an explicit fixture is supplied', () => {
  for (const value of [null, '', 'unknown', 0, {}, true]) {
    assert.throws(() => validateAudioPreset(value), RangeError);
    assert.throws(() => resolveAudioFixtures(stock, explicit(), value), RangeError);
  }
});

test('resolving one matching image cannot carry its inferred fixture to another image', () => {
  assert.equal(resolveAudioFixtures(stock, undefined, STOCK_AUDIO_PRESET), STOCK_V552_SILENT_FIXTURES);
  assert.equal(resolveAudioFixtures({...stock, sha256: 'c'.repeat(64)}, undefined, STOCK_AUDIO_PRESET), undefined);
  assert.equal(resolveAudioFixtures(stock, undefined, STOCK_AUDIO_PRESET), STOCK_V552_SILENT_FIXTURES);
});

test('resolver calls preserve the supplied image and explicit fixture', () => {
  const fixture = Object.freeze(explicit());
  const before = JSON.stringify({stock, fixture});
  assert.equal(resolveAudioFixtures(stock, fixture, STOCK_AUDIO_PRESET), fixture);
  assert.equal(resolveAudioFixtures(stock, undefined, STOCK_AUDIO_PRESET), STOCK_V552_SILENT_FIXTURES);
  assert.equal(JSON.stringify({stock, fixture}), before);
});


test('the browser stock fixture retains its separately selected synthetic interval', () => {
  assert.equal(STOCK_V552_SILENT_FIXTURES.slotTicks, 128);
});
