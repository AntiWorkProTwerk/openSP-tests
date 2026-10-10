import assert from 'node:assert/strict';
import test from 'node:test';
import {SPBoard} from '../src/lib/emulator/board.ts';

const VIDEO = 0x400d80a0;

test('VIDEO board routing owns only its control aliases and two fractional words', () => {
  const board = new SPBoard({videoPll: {lockTicks: 3}});
  assert.equal(board.read(VIDEO), 0x1100c);
  assert.equal(board.read(VIDEO + 0x10), 0x05f5e100);
  assert.equal(board.read(VIDEO + 0x20), 0x10a24447);
  board.write(VIDEO + 0x10, 1);
  board.write(VIDEO + 0x20, 10);
  board.write(VIDEO, 0x10020);
  board.tick(2);
  assert.equal(board.status().videoPll.locked, false);
  board.tick(1);
  assert.equal(board.read(VIDEO + 3, 1), 0x80);
  board.write(VIDEO + 10, 1, 1);
  assert.equal(board.status().videoPll.bypassed, false);
  assert.equal(board.read(VIDEO + 8), 0);
  assert.equal(board.read(0x400d8000), 0x13063);
  assert.equal(board.read(0x400d8010), 0x80000000);
  assert.equal(board.read(0x400d8020), 0x12000);
  for (const address of [VIDEO - 4, VIDEO + 0x14, VIDEO + 0x24]) {
    assert.equal(board.read(address), undefined);
  }
  assert.equal(board.status().unknownMmio.length, 3);
  board.reset();
  assert.equal(board.read(VIDEO), 0x1100c);
  assert.equal(board.read(VIDEO + 0x10), 0x05f5e100);
  assert.equal(board.read(VIDEO + 0x20), 0x10a24447);
  assert.equal(board.status().videoPll.locked, false);
});

test('VIDEO synthetic clock advances with GPT stopped and retains its failure fixture after reset', () => {
  const board = new SPBoard({videoPll: {lockFailure: true}, timerReadTicks: 24000});
  board.write(VIDEO + 0x10, 0);
  board.write(VIDEO + 0x20, 1);
  board.write(VIDEO, 27);
  board.tick(0x100000000);
  assert.equal(board.status().videoPll.ticks, 0x100000000);
  assert.equal(board.status().videoPll.locked, false);
  assert.equal(board.read(0x401ec024), 0);
  board.reset();
  board.write(VIDEO + 0x10, 0);
  board.write(VIDEO + 0x20, 1);
  board.write(VIDEO, 27);
  board.tick(1);
  assert.equal(board.status().videoPll.configuration.lockFailure, true);
  assert.equal(board.status().videoPll.locked, false);
});
