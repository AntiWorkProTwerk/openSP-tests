import type {EmulatorWorkerBridge} from './worker-rpc.ts';
import {
  prepareVirtualUpdateCandidate, VirtualFirmwareUpdater, VirtualUpdateError,
  type UpdateProgress, type VirtualUpdateReceipt,
} from './update.ts';

export interface VirtualUiManifest {
  profile: 'R13' | 'R14' | 'R15';
  expectedMarker: number;
  expectedSha256: string;
  length: number;
}

const normalWriters = [
  {profile: 'R13' as const, marker: 0x523d0001, hex: '523D0001'},
  {profile: 'R14' as const, marker: 0x523e0001, hex: '523E0001'},
  {profile: 'R15' as const, marker: 0x523f0001, hex: '523F0001'},
];
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function requireValue(value: unknown, phase: string, code: string, message: string): asserts value {
  if (!value) throw new VirtualUpdateError(phase, code, message);
}

/** Read only the package fields needed for a bounded virtual update. */
export function parseVirtualUpdateManifest(raw: unknown): VirtualUiManifest {
  requireValue(object(raw) && object(raw.usb_install), 'image', 'manifest-format',
    'Select a package manifest with usb_marker and usb_install fields.');
  const marker = raw.usb_marker, install = raw.usb_install;
  const writer = typeof marker === 'string' && /^[a-f0-9]{8}$/i.test(marker)
    ? normalWriters.find(row => row.hex === marker.toUpperCase()) : undefined;
  requireValue(writer, 'image', 'manifest-profile',
    'The manifest must identify normal R13, R14 or R15 firmware.');
  const length = install.bytes, hash = install.sha256;
  requireValue(typeof length === 'number' && Number.isInteger(length) &&
    length >= 2048 && length <= 65536 && length % 4 === 0,
  'image', 'manifest-length', 'Manifest usb_install.bytes must be an aligned integer from 2048 to 65536.');
  requireValue(typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash),
    'image', 'manifest-hash', 'Manifest usb_install.sha256 must contain the complete SHA256.');
  return {profile: writer.profile, expectedMarker: writer.marker, expectedSha256: hash.toLowerCase(), length};
}

function ownManifest(manifest: VirtualUiManifest): VirtualUiManifest {
  const writer = normalWriters.find(row => row.profile === manifest?.profile && row.marker === manifest?.expectedMarker);
  requireValue(writer, 'image', 'manifest-profile', 'The parsed manifest profile and marker must agree.');
  return parseVirtualUpdateManifest({usb_marker: writer.hex,
    usb_install: {bytes: manifest.length, sha256: manifest.expectedSha256}});
}
function notCancelled(signal: AbortSignal | undefined) {
  requireValue(!signal?.aborted, 'setup', 'cancelled', 'The virtual update was cancelled.');
}

export class VirtualApp1Update {
  private readonly bridge: EmulatorWorkerBridge;
  private busy = false;
  constructor(bridge: EmulatorWorkerBridge) {this.bridge = bridge;}

  async update(candidate: Uint8Array, manifest: VirtualUiManifest,
    options: {signal?: AbortSignal; onProgress?: (progress: UpdateProgress) => void} = {},
  ): Promise<VirtualUpdateReceipt> {
    requireValue(!this.busy, 'setup', 'concurrent-client', 'A virtual update is already active for this session.');
    this.busy = true;
    try {
      const pin = ownManifest(manifest), {signal, onProgress} = options;
      requireValue(candidate instanceof Uint8Array && candidate.length === pin.length,
        'image', 'image-size', 'The binary length must match the selected package manifest.');
      const bytes = new Uint8Array(candidate);
      notCancelled(signal);
      const target = {expectedMarker: pin.expectedMarker, expectedSha256: pin.expectedSha256, signal};
      const prepared = await prepareVirtualUpdateCandidate(bytes, target, 'R13');
      notCancelled(signal);
      await this.bridge.pause({signal, timeoutMs: 45000});
      notCancelled(signal);
      const bound = this.bridge.asUpdateBridge({signal, timeoutMs: 45000});
      const updater = new VirtualFirmwareUpdater(bound, {operationTimeoutMs: 45000});
      const {profile, status} = await updater.inspect();
      const running = normalWriters.find(row => row.profile === profile.name && row.marker === status.build_marker);
      requireValue(running, 'preflight', 'ui-writer-profile',
        'The virtual session must be running normal R13, R14 or R15 firmware.');
      notCancelled(signal);
      const snapshot = await bound.snapshot();
      requireValue(snapshot.marker === running.marker && snapshot.firmwareState === 2 &&
        typeof snapshot.firmwareHash === 'string' && /^[a-f0-9]{64}$/.test(snapshot.firmwareHash),
      'preflight', 'running-image-pin', 'The running snapshot must identify the inspected writer and its complete image hash.');
      notCancelled(signal);
      return await updater.update(prepared.bytes, {...target,
        expectedRunningMarker: running.marker, expectedRunningSha256: snapshot.firmwareHash,
        onProgress: progress => {
          try {void Promise.resolve(onProgress?.({...progress})).catch(() => {});}
          catch { /* Progress rendering cannot interrupt an update. */ }
        },
      });
    } finally {this.busy = false;}
  }
}
