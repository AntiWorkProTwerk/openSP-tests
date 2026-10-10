import assert from 'node:assert/strict';
import test from 'node:test';
import { SPBoard } from '../src/lib/emulator/board.ts';

const REG0 = 0x40080000, REG1 = REG0 + 4, REG3 = REG0 + 12;
const GPT = 0x401ec000;

test('board routes DCDC targets, status and independent settling while GPT is disabled', () => {
  const board = new SPBoard({dcdc: {settleTicks: 3}});
  assert.equal(board.read(REG0), 0x14030111);
  assert.equal(board.read(REG1), 0x111ba29c);
  board.tick(2);
  assert.equal(board.status().dcdc.dcOk, false);
  assert.equal(board.read(GPT + 0x24), 0);
  board.write(REG3, 0x11, 1);
  assert.equal(board.read(REG3), 0x111);
  board.tick(2); assert.equal(board.read(REG0, 4) >>> 31, 0);
  board.tick(1); assert.equal(board.read(REG0 + 3, 1) & 0x80, 0x80);
  assert.equal(board.status().dcdc.targetRun, 17);
  assert.equal(board.status().dcdc.settlingElapsed, 3);
  board.write(REG1, 0);
  assert.equal(board.read(REG1), 0x001b801c);
  assert.equal(board.read(REG0) >>> 31, 1, 'REG1 is a separate word, not a SET alias.');
  assert.equal(board.read(REG0 + 0x10), undefined);
  assert.deepEqual(board.status().unknownMmio,
    [{address: REG0 + 0x10, width: 4, operation: 'read', count: 1}]);
  board.reset();
  assert.equal(board.read(REG3), 0x10e);
  assert.equal(board.status().dcdc.dcOk, false);
  board.tick(3); assert.equal(board.status().dcdc.dcOk, true);
  assert.equal(board.status().unknownMmio.length, 0);
});

test('board preserves stalled DCDC across reset and does not advance it on timer reads', () => {
  const board = new SPBoard({dcdc: {settleTicks: 3, settlingFailure: true}, timerReadTicks: 24000});
  board.write(0x400fc01c, 0x40); board.write(0x400ac014, 0); board.write(GPT, 0x283);
  board.tick(7);
  assert.equal(board.status().dcdc.ticks, 7);
  assert.equal(board.status().dcdc.dcOk, false);
  assert.equal(board.read(GPT + 0x24), 24000);
  assert.equal(board.status().dcdc.ticks, 7);
  assert.ok(board.status().dcdc.blockingReasons.includes('settling-failure fixture is true'));
  board.reset(); board.tick(0x100000000);
  assert.equal(board.status().dcdc.ticks, 0x100000000);
  assert.equal(board.status().dcdc.dcOk, false);
  assert.equal(board.status().dcdc.configuration.settlingFailure, true);
  assert.equal(board.status().unknownMmio.length, 0);
});
