import type {SPBoard} from './board.ts';
import type {ArmCPU} from './cpu.ts';
import {bindDisplayTransport as bindDisplayOnly, DISPLAY_FIXTURES} from './display-session-binding.ts';
import type {AudioFixtures} from './display-types.ts';
import {admitStockAudioRam} from './audio-maps.ts';

export {DISPLAY_FIXTURES};
export type {AudioFixtures};

// Declared synthetic input, with no measured clock rate or physical slot identity.
// Callers opt into audio explicitly; absent fixtures retain the display-only path.
export const AUDIO_FIXTURES: Readonly<AudioFixtures> = Object.freeze({saiClockReady: true,
  externalClock: true, slotTicks: 8, rxFrame: Object.freeze(Array<number>(16).fill(0))});

export function ownAudioFixtures(fixture: AudioFixtures): Readonly<AudioFixtures> {
  if (!fixture) throw new RangeError('Explicit finite audio fixtures are required');
  const {saiClockReady, externalClock, slotTicks, rxFrame} = fixture;
  const words = Array.isArray(rxFrame) ? [...rxFrame] : undefined;
  if (typeof saiClockReady !== 'boolean' || typeof externalClock !== 'boolean' ||
    !Number.isSafeInteger(slotTicks) || slotTicks < 1 || slotTicks > 1000000 ||
    !words || words.length !== 16 ||
    !words.every(word => Number.isInteger(word) && word >= 0 && word <= 0xffffffff))
    throw new RangeError('Explicit finite audio fixtures are required');
  return Object.freeze({saiClockReady, externalClock, slotTicks, rxFrame: Object.freeze(words)});
}

export function bindDisplayTransport(board: SPBoard, cpu: Pick<ArmCPU, 'memoryMap'>, audio?: AudioFixtures): void {
  if (audio === undefined) {bindDisplayOnly(board, cpu); return;}
  const audioFixtures = ownAudioFixtures(audio);
  const admission = admitStockAudioRam(cpu.memoryMap);
  board.configureDisplayTransport({...admission, fixtures: {...DISPLAY_FIXTURES}, audioFixtures});
}
