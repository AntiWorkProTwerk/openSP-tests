import {VIRTUAL_SD_GEOMETRY} from './usdhc.ts';
import type {USDHCStatus} from './usdhc.ts';

/** Local fixture bytes only; card scheduling and IRQ ownership remain in SPBoard. */
export type VirtualSdImage = Uint8Array | ArrayBuffer;
export interface VirtualSdFixtures {sd1?: VirtualSdImage; sd2?: VirtualSdImage}
export interface OwnedSdFixtures {sd1?: Uint8Array<ArrayBuffer>; sd2?: Uint8Array<ArrayBuffer>}
export interface VirtualSdMetadata {profile: string; imageBytes: number; readOnly: true}
export type VirtualSdStatus = VirtualSdMetadata & Partial<Omit<USDHCStatus, keyof VirtualSdMetadata>>;

function checkedView(image: unknown, slot: string): Uint8Array<ArrayBuffer> {
  if (!(image instanceof ArrayBuffer || image instanceof Uint8Array) ||
    image instanceof Uint8Array && !(image.buffer instanceof ArrayBuffer)) {
    throw new Error(`${slot} requires local Uint8Array or ArrayBuffer bytes with an unshared backing buffer.`);
  }
  let view: Uint8Array<ArrayBuffer>;
  try {view = image instanceof ArrayBuffer ? new Uint8Array(image)
    : new Uint8Array(image.buffer as ArrayBuffer, image.byteOffset, image.byteLength);} catch {
    throw new Error(`${slot} requires readable local bytes from an attached backing buffer.`);
  }
  const size = view.byteLength;
  const geometry = VIRTUAL_SD_GEOMETRY;
  if (size < geometry.minimumImageBytes || size > geometry.maximumImageBytes || size % geometry.capacityUnitBytes !== 0) {
    throw new Error(`${slot} requires 256 KiB..128 MiB in exact 256 KiB capacity units.`);
  }
  return view;
}

/** Validate both slots before allocation, then copy each admitted view independently. */
export function ownSdFixtures(fixtures: VirtualSdFixtures): OwnedSdFixtures {
  const views: OwnedSdFixtures = {};
  for (const slot of ['sd1', 'sd2'] as const) {
    if (fixtures[slot] !== undefined) views[slot] = checkedView(fixtures[slot], slot);
  }
  const owned: OwnedSdFixtures = {};
  for (const slot of ['sd1', 'sd2'] as const) if (views[slot]) {
    const copy = new Uint8Array(views[slot].byteLength); copy.set(views[slot]); owned[slot] = copy;
  }
  return owned;
}

/** Observation metadata contains no filename, content, hash or backing buffer. */
export function describeSdFixture(image: VirtualSdImage | undefined): VirtualSdMetadata | undefined {
  if (image === undefined) return undefined;
  const view = checkedView(image, 'SD fixture');
  return {profile: VIRTUAL_SD_GEOMETRY.profile, imageBytes: view.byteLength, readOnly: true};
}

/** Admit only documented scalar diagnostics. Unexpected content fields are discarded. */
export function safeSdStatus(value: unknown): VirtualSdStatus | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) throw new Error('Invalid SD metadata.');
  const raw = value as Record<string, unknown>;
  const geometry = VIRTUAL_SD_GEOMETRY;
  if (raw.profile !== geometry.profile || raw.readOnly !== true || typeof raw.imageBytes !== 'number' ||
    !Number.isSafeInteger(raw.imageBytes) || raw.imageBytes < geometry.minimumImageBytes || raw.imageBytes > geometry.maximumImageBytes ||
    raw.imageBytes % geometry.capacityUnitBytes !== 0) throw new Error('Invalid SD metadata.');
  const safe: Record<string, unknown> = {profile: raw.profile, imageBytes: raw.imageBytes, readOnly: true};
  for (const key of ['baseAddress', 'irq', 'blockLength', 'transferBytes', 'transferReadBytes', 'fifoWords',
    'completedCommands', 'completedReads', 'bytesRead', 'unsupportedOverflow']) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'number' || !Number.isSafeInteger(raw[key]) || raw[key] < 0) throw new Error('Invalid SD metadata.');
    safe[key] = raw[key];
  }
  for (const key of ['irqAsserted', 'inserted']) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') throw new Error('Invalid SD metadata.'); safe[key] = raw[key];
  }
  if (raw.cardBusWidth !== undefined) {
    if (raw.cardBusWidth !== 1 && raw.cardBusWidth !== 4) throw new Error('Invalid SD metadata.'); safe.cardBusWidth = raw.cardBusWidth;
  }
  if (raw.cardState !== undefined) {
    if (!['idle', 'ready', 'identification', 'standby', 'transfer', 'sending-data'].includes(raw.cardState as string)) throw new Error('Invalid SD metadata.');
    safe.cardState = raw.cardState;
  }
  if (raw.pendingCommand !== undefined) {
    if (raw.pendingCommand !== null && (typeof raw.pendingCommand !== 'number' || !Number.isInteger(raw.pendingCommand) || raw.pendingCommand < 0 || raw.pendingCommand > 63)) throw new Error('Invalid SD metadata.');
    safe.pendingCommand = raw.pendingCommand;
  }
  if (raw.lastError !== undefined) {
    if (raw.lastError !== null && typeof raw.lastError !== 'string') throw new Error('Invalid SD metadata.'); safe.lastError = raw.lastError;
  }
  if (raw.unsupported !== undefined) {
    if (!Array.isArray(raw.unsupported) || raw.unsupported.length > 128) throw new Error('Invalid SD metadata.');
    safe.unsupported = raw.unsupported.map(row => {
      if (!row || typeof row.reason !== 'string' || !Number.isSafeInteger(row.count) || row.count < 0) throw new Error('Invalid SD metadata.');
      return {reason: row.reason, count: row.count};
    });
  }
  if (raw.limitations !== undefined) {
    if (!Array.isArray(raw.limitations) || raw.limitations.some(item => typeof item !== 'string')) throw new Error('Invalid SD metadata.'); safe.limitations = [...raw.limitations];
  }
  return safe as unknown as VirtualSdStatus;
}
