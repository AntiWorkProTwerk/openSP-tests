import assert from 'node:assert/strict';
import test from 'node:test';
import {SPBoard} from '../src/lib/emulator/board.ts';
const USB2 = 0x400d8020;

test('board owns USB2 aliases, lock ticks and status without changing neighboring PLL routes', () => {
  const board = new SPBoard({usb2Pll: {lockTicks: 3}});
  assert.equal(board.read(USB2), 0x12000);
  board.write(USB2 + 5, 0x10, 1);
  board.tick(2); assert.equal(board.status().usb2Pll.locked, false);
  board.tick(1); assert.equal(board.read(USB2 + 3, 1), 0x80);
  board.write(USB2 + 10, 1, 1);
  assert.equal(board.status().usb2Pll.bypassed, false);
  assert.equal(board.read(USB2 + 8), 0);
  assert.equal(board.read(USB2 - 0x20), 0x13063);
  assert.equal(board.read(USB2 - 0x10), 0x80000000);
  assert.equal(board.read(USB2 + 0x10), undefined);
  assert.equal(board.status().unknownMmio.length, 1);
  board.reset(); assert.equal(board.read(USB2), 0x12000);
  assert.equal(board.status().usb2Pll.locked, false);
});

test('USB2 board ticks remain independent of GPT and retain a failure fixture through reset', () => {
  const board = new SPBoard({usb2Pll: {lockFailure: true}, timerReadTicks: 24000});
  board.write(USB2, 0x13040); board.tick(0x100000000);
  assert.equal(board.status().usb2Pll.ticks, 0x100000000);
  assert.equal(board.status().usb2Pll.locked, false);
  assert.equal(board.read(0x401ec024), 0);
  board.reset(); board.write(USB2, 0x13040); board.tick(1);
  assert.equal(board.status().usb2Pll.configuration.lockFailure, true);
  assert.equal(board.status().usb2Pll.locked, false);
});
