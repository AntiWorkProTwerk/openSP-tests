import assert from 'node:assert/strict';
import test from 'node:test';
import {SPBoard} from '../src/lib/emulator/board.ts';

const ARM = 0x400d8000, GPT = 0x401ec000;

test('board routes ARM PLL aliases and lock ticks independently of a disabled GPT', () => {
  const board = new SPBoard({armPll: {lockTicks: 3}});
  assert.equal(board.read(ARM), 0x13063);
  board.write(ARM, 0x12058); // Source0, divider88, powered, still bypassed.
  board.tick(2);
  assert.equal(board.status().armPll.locked, false);
  assert.equal(board.read(GPT + 0x24), 0);
  board.tick(1);
  assert.equal(board.read(ARM + 3, 1), 0x80);
  assert.equal(board.status().armPll.bypassed, true);
  board.write(ARM + 9, 0x20, 1); // CLR alias: output enable only.
  assert.equal(board.status().armPll.outputEnabled, false);
  assert.equal(board.status().armPll.locked, true);
  assert.equal(board.read(ARM + 8), 0);
  assert.equal(board.read(ARM - 4), undefined);
  assert.equal(board.read(ARM + 0x100), undefined);
  assert.deepEqual(board.status().unknownMmio.map(item => item.address), [ARM - 4, ARM + 0x100]);
  // The adjacent USB PLL keeps its existing separate fixture route.
  assert.equal(board.read(ARM + 0x10), 0x80000000);
  board.write(ARM + 0x10, 0x3000);
  assert.equal(board.read(ARM + 0x10), 0x80003000);
  board.reset();
  assert.equal(board.read(ARM), 0x13063);
  assert.equal(board.status().armPll.ticks, 0);
  assert.equal(board.status().armPll.locked, false);
  assert.equal(board.status().unknownMmio.length, 0);
});

test('board preserves ARM PLL missing-reference fixtures and chunks large independent ticks', () => {
  const board = new SPBoard({armPll: {reference24MAvailable: false}, timerReadTicks: 24000});
  board.write(ARM, 0x12058);
  board.tick(0x100000000);
  assert.equal(board.status().armPll.ticks, 0x100000000);
  assert.equal(board.status().armPll.locked, false);
  assert.ok(board.status().armPll.blockingReasons.includes('selected reference fixture is unavailable'));
  board.write(0x400fc01c, 0x40); board.write(0x400ac014, 0); board.write(GPT, 0x283);
  board.read(GPT + 0x24);
  assert.equal(board.status().armPll.ticks, 0x100000000);
  board.reset();
  board.write(ARM, 0x12058); board.tick(1);
  assert.equal(board.status().armPll.configuration.reference24MAvailable, false);
  assert.equal(board.status().armPll.locked, false);
  assert.equal(board.status().armPll.divider, 88);
  assert.equal(board.status().armPll.referenceSourceCode, 0);
});
