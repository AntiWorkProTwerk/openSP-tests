import assert from 'node:assert/strict';
import test from 'node:test';
import {SPBoard} from '../src/lib/emulator/board.ts';

const AUDIO = 0x400d8070;

test('AUDIO routes only its control aliases and standalone fractional words', () => {
  const board = new SPBoard({audioPll: {lockTicks: 3}});
  assert.equal(board.read(AUDIO), 0x11006);
  assert.equal(board.read(AUDIO + 0x10), 0x05f5e100);
  assert.equal(board.read(AUDIO + 0x20), 0x2964619c);
  board.write(AUDIO + 0x10, 0);
  board.write(AUDIO + 0x20, 1);
  board.write(AUDIO, 0x10036);
  board.tick(2);
  assert.equal(board.status().audioPll.locked, false);
  board.tick(1);
  assert.equal(board.read(AUDIO + 3, 1), 0x80);
  board.write(AUDIO + 10, 1, 1);
  assert.equal(board.status().audioPll.bypassed, false);
  assert.equal(board.read(AUDIO + 8), 0);
  assert.equal(board.read(0x400d80a0), 0x1100c);
  assert.equal(board.read(0x400d80b0), 0x05f5e100);
  assert.equal(board.read(0x400d80c0), 0x10a24447);
  for (const address of [AUDIO - 4, AUDIO + 0x14, AUDIO + 0x24]) {
    assert.equal(board.read(address), undefined);
  }
  assert.equal(board.status().unknownMmio.length, 3);
  board.reset();
  assert.equal(board.read(AUDIO), 0x11006);
  assert.equal(board.read(AUDIO + 0x10), 0x05f5e100);
  assert.equal(board.read(AUDIO + 0x20), 0x2964619c);
  assert.equal(board.status().audioPll.locked, false);
});

test('AUDIO reference failure survives reset and synthetic ticks do not depend on GPT', () => {
  const board = new SPBoard({audioPll: {reference24MAvailable: false}, timerReadTicks: 24000});
  board.write(AUDIO + 0x10, 0);
  board.write(AUDIO + 0x20, 1);
  board.write(AUDIO, 54);
  board.tick(0x100000000);
  assert.equal(board.status().audioPll.ticks, 0x100000000);
  assert.equal(board.status().audioPll.locked, false);
  assert.equal(board.read(0x401ec024), 0);
  board.reset();
  board.write(AUDIO + 0x10, 0);
  board.write(AUDIO + 0x20, 1);
  board.write(AUDIO, 54);
  board.tick(1);
  assert.equal(board.status().audioPll.configuration.reference24MAvailable, false);
  assert.equal(board.status().audioPll.locked, false);
});
