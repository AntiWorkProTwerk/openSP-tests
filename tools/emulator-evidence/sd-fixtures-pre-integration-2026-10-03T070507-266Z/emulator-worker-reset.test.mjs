import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import {validateApp1ResetContract} from '../src/lib/emulator/image.ts';

// Execute the production message handler with fake module boundaries. This is
// a protocol test, with no Worker thread, CPU, firmware or browser execution.
function fixture() {
  const source = readFileSync(new URL('../src/scripts/emulator-worker.ts', import.meta.url), 'utf8');
  let script = stripTypeScriptTypes(source);
  for (const [expression, replacement] of [
    ["await import('../lib/emulator/session')", 'await testModules.loadSession()'],
    ["await import('../lib/emulator/image')", 'await testModules.loadImage()'],
  ]) {
    assert.equal(script.split(expression).length, 2, 'Only the inspected module boundary is replaced.');
    script = script.replace(expression, replacement);
  }
  let listener;
  const sent = [], resetTargets = [];
  const fakeSession = {state: 'loaded', pauses: 0, resets: 0, closed: 0,
    pause() {this.pauses++;}, close() {this.closed++;},
    snapshot() {return {state: this.state, instructions: 0, firmwareHash: 'a'.repeat(64)};},
    async reset(target) {
      resetTargets.push(target);
      if (target?.selector) throw new Error('B1 DEL writer reset is unqualified.');
      this.resets++;
    },
  };
  const scope = {postMessage(message) {sent.push(structuredClone(message));},
    addEventListener(event, callback) {assert.equal(event, 'message'); listener = callback;}};
  new vm.Script(script, {filename: 'production-emulator-worker-reset.js'}).runInNewContext({
    self: scope, ArrayBuffer, Uint8Array, performance, setTimeout, clearTimeout,
    testModules: {async loadSession() {return {async createSession() {return fakeSession;}};},
      async loadImage() {return {validateApp1ResetContract};}},
  });
  const dispatch = async request => {
    const start = sent.length;
    listener({data: request});
    for (let turn = 0; turn < 20 && !sent.slice(start).some(message => message.id === request.id); turn++)
      await new Promise(resolve => setImmediate(resolve));
    const messages = sent.slice(start).filter(message => message.id === request.id);
    assert.ok(messages.length, 'The bounded fake command receives its own response.');
    return messages;
  };
  return {fakeSession, resetTargets, dispatch};
}
const contract = () => ({length: 2048, sha256: 'b'.repeat(64), expectedCurrentSha256: 'a'.repeat(64)});
const load = fake => fake.dispatch({id: 1, command: 'load', image: new ArrayBuffer(4), format: 'app1'});

test('production reset handler forwards an owned validated target to the session', async () => {
  const fake = fixture(); await load(fake);
  const target = contract(); target.sha256 = target.sha256.toUpperCase();
  const response = await fake.dispatch({id: 2, command: 'reset', target});
  assert.deepEqual(fake.resetTargets, [contract()]);
  assert.notEqual(fake.resetTargets[0], target);
  assert.equal(fake.fakeSession.resets, 1);
  assert.equal(response[0].type, 'status'); assert.equal(response[0].instructions, 0);
});

test('production reset handler rejects malformed target messages before stopping or resetting', async () => {
  for (const target of [null, [], {...contract(), length: 0x37f001}, {...contract(), length: 4.5},
    {...contract(), sha256: '0'}, {...contract(), expectedCurrentSha256: 7},
    {...contract(), selector: 'stock'}, {...contract(), ignored: true}]) {
    const fake = fixture(); await load(fake);
    const beforePauses = fake.fakeSession.pauses;
    const response = await fake.dispatch({id: 2, command: 'reset', target});
    assert.equal(response[0].type, 'error');
    assert.equal(fake.fakeSession.pauses, beforePauses);
    assert.equal(fake.fakeSession.resets, 0); assert.deepEqual(fake.resetTargets, []);
  }
});

test('production reset handler preserves generic reset and surfaces selector refusal', async () => {
  const fake = fixture(); await load(fake);
  assert.equal((await fake.dispatch({id: 2, command: 'reset'}))[0].type, 'status');
  assert.deepEqual(fake.resetTargets, [undefined]);
  const response = await fake.dispatch({id: 3, command: 'reset', target: {...contract(), selector: 'b1-del-writer'}});
  assert.equal(response[0].type, 'error'); assert.match(response[0].message, /unqualified/);
  assert.equal(fake.fakeSession.resets, 1);
});
