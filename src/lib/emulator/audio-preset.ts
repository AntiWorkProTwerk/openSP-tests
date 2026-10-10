import {AUDIO_FIXTURES, type AudioFixtures} from './audio-session-binding.ts';
import type {FirmwareImage} from './image.ts';

export const STOCK_AUDIO_PRESET = 'stock-v552-silent' as const;
export type StockAudioPreset = typeof STOCK_AUDIO_PRESET;
/** Separate stock fixture choice; the current timing is synthetic. */
export const STOCK_V552_SILENT_FIXTURES: Readonly<AudioFixtures> = Object.freeze({...AUDIO_FIXTURES, slotTicks: 128});
const STOCK_V552_APP1_SHA256 = '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80';

export function validateAudioPreset(value: unknown): StockAudioPreset | undefined {
  if (value === undefined || value === STOCK_AUDIO_PRESET) return value;
  throw new RangeError('Choose the supported stock audio preset or leave it unset.');
}

/** Resolve declared synthetic audio inputs against the current admitted image. */
export function resolveAudioFixtures(image: Pick<FirmwareImage, 'format' | 'sha256'>,
  explicitAudioFixture?: AudioFixtures, preset?: StockAudioPreset): AudioFixtures | undefined {
  const selected = validateAudioPreset(preset);
  if (explicitAudioFixture !== undefined) return explicitAudioFixture;
  if (selected === STOCK_AUDIO_PRESET && image.format === 'app1' && image.sha256 === STOCK_V552_APP1_SHA256)
    return STOCK_V552_SILENT_FIXTURES;
  return undefined;
}
