import test from 'node:test';
import assert from 'node:assert/strict';
import {RunnerMode, RunnerOwner, relativeValue} from './fixtures/test-typescript-loader.ts';
import {load} from '../tools/test-typescript-loader.mjs';

test('TypeScript parameter properties retain constructor ownership and live callbacks', () => {
  let current = 7;
  const owner = new RunnerOwner(7, () => current);
  assert.equal(owner.token, 7);
  assert.equal(Object.hasOwn(owner, 'token'), true);
  assert.equal(owner.isCurrent(), true);
  current = 8;
  assert.equal(owner.isCurrent(), false);
});

test('TypeScript enums retain forward and reverse runtime mappings', () => {
  assert.equal(RunnerMode.Idle, 2);
  assert.equal(RunnerMode.Selected, 3);
  assert.equal(RunnerMode[3], 'Selected');
});

test('relative TypeScript imports execute with erased type-only imports and assertions', () => {
  assert.equal(relativeValue(60), 64);
  assert.equal(relativeValue(-4), 0);
});

test('test loader delegates dependencies, JavaScript and files outside project source roots', async () => {
  const urls = [
    new URL('../node_modules/dependency.ts', import.meta.url).href,
    new URL('../outside-source-root.ts', import.meta.url).href,
    new URL('../../outside-project.ts', import.meta.url).href,
    new URL('./emulator-test-runner.test.mjs', import.meta.url).href,
    'https://example.invalid/module.ts',
  ];
  for (const url of urls) {
    const context = {format: 'module'};
    let calls = 0;
    const expected = {format: 'module', source: 'delegated'};
    assert.equal(await load(url, context, (received, passed) => {
      calls++;
      assert.equal(received, url);
      assert.equal(passed, context);
      return expected;
    }), expected);
    assert.equal(calls, 1);
  }
});
