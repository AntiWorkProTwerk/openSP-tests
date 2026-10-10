/**
 * Virtual APP1 update host. The supplied transport exchanges 64-byte feature
 * payloads with executed firmware; no HID, WebUSB or physical-device API exists.
 * Source contracts: tools/usb_upload.py, tools/usb_flash_r13.py (and R14/R15),
 * sdk/examples/original_r13/{USB.md,FLASH.md,usb_upload.c,flash.c}.
 */

export interface WriterProfile {
  name: 'R13' | 'R14' | 'R15';
  signature: string;
  markers: readonly number[];
  maximum: number;
}
export const VIRTUAL_WRITER_PROFILES: readonly WriterProfile[] = Object.freeze([
  Object.freeze({ name: 'R13' as const, signature: 'SP13', markers: Object.freeze([0x523d0001, 0x523d0002]), maximum: 65536 }),
  Object.freeze({ name: 'R14' as const, signature: 'SP14', markers: Object.freeze([0x523e0001, 0x523e0002]), maximum: 65536 }),
  Object.freeze({ name: 'R15' as const, signature: 'SP15', markers: Object.freeze([0x523f0001, 0x523f0002]), maximum: 65536 }),
]);

export const VIRTUAL_UPDATE_SOURCES = Object.freeze({
  packet: 'tools/usb_upload.py',
  hosts: ['tools/usb_flash_r13.py', 'tools/usb_flash_r14.py', 'tools/usb_flash_r15.py'],
  wire: 'sdk/examples/original_r13/USB.md',
  receiver: 'sdk/examples/original_r13/usb_upload.c',
  writer: 'sdk/examples/original_r13/flash.c',
  measuredProfile: 'analysis/hardware/usb_r11_20260922T190757Z/preflight.json',
});

export interface UpdateStatus {
  signature: string;
  version: number; state: number; error: number; length: number; received: number;
  crc32: number; maximum: number; capabilities: number; jedec: number;
  flash_status: number; flash_error: number; programmed: number; flash_ready: number;
  flash_crc32: number; build_marker: number;
}
export interface UpdateDiagnostics {
  headerHex: string; bfptHex: string;
  phase: number; bfpt_dwords: number; bfpt_pointer: number; legacy_profile: number;
  jedec: number; flash_status: number; flash_error: number; flash_ready: number; reserved: number;
}
export interface VirtualUpdateSnapshot {
  marker?: number;
  firmwareState?: number;
  firmwareHash?: string;
  unknownMmio?: readonly unknown[];
  unknownMmioOverflow?: number;
  cpuBackendFailed?: boolean;
  fault?: unknown;
  flash?: { lastError?: string };
}
export interface VirtualUpdateBridge {
  /** Exactly 64 payload bytes. Request undefined reads normal GET_REPORT. */
  transport(request?: number[]): Promise<number[]>;
  /** Re-create the guest CPU/BSS and boot persistent NOR; a USB bus reset is insufficient. */
  reset(): Promise<void>;
  /** Executed image identity and model diagnostics, including evidence before reset. */
  snapshot(): Promise<VirtualUpdateSnapshot>;
}
export interface UpdateProgress {
  phase: 'image' | 'preflight' | 'upload' | 'ram-verified' | 'commit' | 'flash-verified' | 'separate-status' | 'reset' | 'boot-verified';
  completedBytes: number;
  totalBytes: number;
}
export interface VirtualUpdateOptions {
  expectedSha256: string;
  expectedMarker: number;
  expectedRunningMarker?: number;
  signal?: AbortSignal;
  onProgress?: (progress: UpdateProgress) => void;
}
export interface VirtualUpdaterOptions {
  /** Poll counts bound virtual transport work independently of wall-clock speed. */
  maximumProbePolls?: number;
  maximumFlashPolls?: number;
  /** Bounds asynchronous transport/reset/snapshot calls; no retry is automatic. */
  operationTimeoutMs?: number;
}
export interface UpdateImageReceipt { sha256: string; crc32: number; length: number; paddedLength: number; expectedMarker: number }
export interface UpdatePreflight {
  profile: WriterProfile;
  status: UpdateStatus;
  diagnostics: UpdateDiagnostics;
  geometry: { capacityBytes: number; pageBytes: number; sectorBytes: number; app1Offset: number; maximumImageBytes: number; evidence: string };
}
export interface VirtualUpdateReceipt {
  scope: 'virtual APP1 update';
  image: UpdateImageReceipt;
  before: UpdateStatus;
  beforeSnapshot: VirtualUpdateSnapshot;
  preflight: UpdatePreflight;
  ramVerified: UpdateStatus;
  flashVerified: UpdateStatus;
  separateStatus: UpdateStatus;
  beforeResetSnapshot: VirtualUpdateSnapshot;
  flashReadback: { verifiedBytes: number; imageCrc32: number; tail: 'FF'; evidence: string };
  bootStatus: UpdateStatus;
  snapshot: VirtualUpdateSnapshot;
  phases: UpdateProgress[];
}

export class VirtualUpdateError extends Error {
  readonly phase: string;
  readonly code: string;
  readonly evidence: unknown;
  constructor(phase: string, code: string, message: string, evidence?: unknown) {
    super(message); this.name = 'VirtualUpdateError'; this.phase = phase; this.code = code; this.evidence = evidence;
  }
}

const STATUS_FIELDS = ['version', 'state', 'error', 'length', 'received', 'crc32', 'maximum',
  'capabilities', 'jedec', 'flash_status', 'flash_error', 'programmed', 'flash_ready',
  'flash_crc32', 'build_marker'] as const;
const DIAGNOSTIC_FIELDS = ['phase', 'bfpt_dwords', 'bfpt_pointer', 'legacy_profile', 'jedec',
  'flash_status', 'flash_error', 'flash_ready', 'reserved'] as const;
const EXPECTED_HEADER = '53464450000101ff00000109300000ffc2000104600000ffffffffffffffffff';
const EXPECTED_BFPT = 'e520f1ffffffff0144eb086b083b04bbeeffffffffff00ffffff00ff0c200f5210d800ff0000000000000000';
const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const hexWord = (value: number) => `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
const crcTable = Uint32Array.from({ length: 256 }, (_, start) => {
  let crc = start;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

export function updateCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

export function updateCommand(opcode: number, argument = 0, payload = new Uint8Array(0), dataLength = 0): number[] {
  if (!Number.isInteger(opcode) || opcode < 0 || opcode > 255 || !Number.isInteger(argument) || argument < 0 || argument > 0xffffffff ||
      payload.length > 56 || !Number.isInteger(dataLength) || dataLength < 0 || dataLength > 56)
    throw new VirtualUpdateError('packet', 'invalid-command', 'Invalid bounded feature-report command.');
  const bytes = new Uint8Array(64);
  bytes[0] = opcode; bytes[1] = 1; bytes[2] = dataLength;
  new DataView(bytes.buffer).setUint32(4, argument, true);
  bytes.set(payload, 8);
  return Array.from(bytes);
}

function payload64(raw: number[], phase: string): Uint8Array {
  if (!Array.isArray(raw) || raw.length !== 64 || raw.some(value => !Number.isInteger(value) || value < 0 || value > 255))
    throw new VirtualUpdateError(phase, 'report-framing', 'Virtual USB must return exactly 64 payload bytes without a leading report ID.');
  return Uint8Array.from(raw);
}
function decodeStatus(raw: number[], phase: string): UpdateStatus {
  const bytes = payload64(raw, phase);
  const view = new DataView(bytes.buffer);
  return { signature: ascii(bytes.subarray(0, 4)),
    ...Object.fromEntries(STATUS_FIELDS.map((name, index) => [name, view.getUint32(4 + index * 4, true)])) } as UpdateStatus;
}
function requireCondition(condition: unknown, phase: string, code: string, message: string, evidence?: unknown): asserts condition {
  if (!condition) throw new VirtualUpdateError(phase, code, message, evidence);
}
function profileFor(status: UpdateStatus, phase: string): WriterProfile {
  const profile = VIRTUAL_WRITER_PROFILES.find(profile => profile.signature === status.signature && profile.markers.includes(status.build_marker));
  requireCondition(profile, phase, 'unknown-writer', `Unsupported writer ${status.signature}/${hexWord(status.build_marker)}; an exact source contract is required.`, status);
  requireCondition(status.version === 2 && status.maximum === profile.maximum && status.capabilities === 1,
    phase, 'writer-contract', `Writer ${profile.name} reports an unsupported version, capacity or capability.`, status);
  return profile;
}
function matchingStatus(status: UpdateStatus, profile: WriterProfile, marker: number, phase: string): void {
  profileFor(status, phase);
  requireCondition(status.signature === profile.signature && status.build_marker === marker,
    phase, 'writer-changed', 'The running writer changed during the transaction.', status);
}
function idleStatus(status: UpdateStatus, phase: string): void {
  requireCondition(status.state === 0 && status.error === 0 && status.flash_error === 0 &&
    status.length === 0 && status.received === 0 && status.crc32 === 0 && status.programmed === 0 && status.flash_crc32 === 0,
    phase, 'writer-not-idle', 'The writer must start from a fresh idle firmware state; reset the virtual session before another update.', status);
}
function healthy(status: UpdateStatus, phase: string): void {
  requireCondition(status.error === 0 && status.flash_error === 0 && status.state !== 3 && status.state !== 7,
    phase, 'firmware-rejected', 'The firmware rejected the virtual update; preserve its status.', status);
}
function healthySnapshot(snapshot: VirtualUpdateSnapshot, phase: string, marker: number, expectedHash?: string): void {
  requireCondition(snapshot?.marker === marker && snapshot.firmwareState === 2 &&
    typeof snapshot.firmwareHash === 'string' && /^[a-f0-9]{64}$/.test(snapshot.firmwareHash) &&
    (expectedHash === undefined || snapshot.firmwareHash === expectedHash),
    phase, 'boot-snapshot', 'The guest snapshot does not identify the expected image in its running state.', snapshot);
  requireCondition(Array.isArray(snapshot.unknownMmio) && snapshot.unknownMmio.length === 0 &&
    snapshot.unknownMmioOverflow === 0 && !snapshot.cpuBackendFailed && !snapshot.fault && !snapshot.flash?.lastError,
    phase, 'incomplete-model', 'The guest reports an execution failure, unsupported peripheral behavior or missing model diagnostics.', snapshot);
}

/** This host permits one operation at a time, including timed-out calls still running. */
export class VirtualFirmwareUpdater {
  private readonly bridge: VirtualUpdateBridge;
  private readonly options: Required<VirtualUpdaterOptions>;
  private busy = false;
  private outstandingOperation = false;

  constructor(bridge: VirtualUpdateBridge, options: VirtualUpdaterOptions = {}) {
    requireCondition(typeof bridge?.transport === 'function' && typeof bridge?.reset === 'function' && typeof bridge?.snapshot === 'function',
      'setup', 'bridge-contract', 'A virtual feature-report transport, full guest reset and executed-image snapshot are required.');
    this.bridge = bridge;
    this.options = { maximumProbePolls: options.maximumProbePolls ?? 200,
      maximumFlashPolls: options.maximumFlashPolls ?? 1200, operationTimeoutMs: options.operationTimeoutMs ?? 30000 };
    for (const [name, value] of Object.entries(this.options))
      requireCondition(Number.isSafeInteger(value) && value > 0 && value <= (name === 'operationTimeoutMs' ? 300000 : 100000),
        'setup', 'invalid-bound', `${name} must be a positive bounded integer.`);
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    requireCondition(!this.busy && !this.outstandingOperation, 'setup', 'concurrent-client', 'A virtual update operation is already active on this transport.');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }

  private abort(signal: AbortSignal | undefined, phase: string): void {
    if (signal?.aborted) throw new VirtualUpdateError(phase, 'cancelled', 'The virtual update was cancelled. A queued or active flash operation may still finish.');
  }

  private async operation<T>(phase: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.abort(signal, phase);
    this.outstandingOperation = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listener: (() => void) | undefined;
    const underlying = Promise.resolve().then(action).finally(() => { this.outstandingOperation = false; });
    try {
      return await Promise.race([
        underlying,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new VirtualUpdateError(phase, 'operation-timeout', `Virtual ${phase} did not complete within its operation bound.`)), this.options.operationTimeoutMs);
          listener = () => reject(new VirtualUpdateError(phase, 'cancelled', 'The virtual update was cancelled. An outstanding operation may still finish.'));
          signal?.addEventListener('abort', listener, { once: true });
        }),
      ]);
    } catch (error) {
      if (error instanceof VirtualUpdateError) throw error;
      throw new VirtualUpdateError(phase, 'transport-failure', `Virtual ${phase} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (listener) signal?.removeEventListener('abort', listener);
    }
  }

  private async exchange(phase: string, request?: number[], signal?: AbortSignal): Promise<number[]> {
    return this.operation(phase, () => this.bridge.transport(request), signal);
  }
  private async status(phase: string, signal?: AbortSignal): Promise<UpdateStatus> {
    return decodeStatus(await this.exchange(phase, undefined, signal), phase);
  }

  inspect(): Promise<{ profile: WriterProfile; status: UpdateStatus }> {
    return this.exclusive(async () => { const status = await this.status('inspect'); return { profile: profileFor(status, 'inspect'), status }; });
  }

  preflight(expectedRunningMarker?: number): Promise<UpdatePreflight> {
    return this.exclusive(async () => {
      const before = await this.status('preflight');
      const profile = profileFor(before, 'preflight');
      idleStatus(before, 'preflight');
      if (expectedRunningMarker !== undefined) requireCondition(before.build_marker === expectedRunningMarker,
        'preflight', 'running-marker', 'The running firmware marker differs from the pinned writer.', before);
      return this.probe(before, profile);
    });
  }

  private async probe(before: UpdateStatus, profile: WriterProfile, signal?: AbortSignal): Promise<UpdatePreflight> {
    let status = decodeStatus(await this.exchange('preflight', updateCommand(5), signal), 'preflight');
    let ready = false;
    for (let poll = 0; poll <= this.options.maximumProbePolls; poll++) {
      matchingStatus(status, profile, before.build_marker, 'preflight'); healthy(status, 'preflight'); idleStatus(status, 'preflight');
      if (status.flash_ready === 1) { ready = true; break; }
      requireCondition(status.flash_ready === 0, 'preflight', 'probe-ready', 'Invalid flash readiness value.', status);
      if (poll === this.options.maximumProbePolls) break;
      status = await this.status('preflight', signal);
    }
    requireCondition(ready, 'preflight', 'probe-timeout', 'The virtual chip/profile probe did not complete; no BEGIN or COMMIT was sent.', status);
    requireCondition(status.jedec === 0xc22016 && status.flash_status === 0x40,
      'preflight', 'chip-profile', 'The measured C22016/status40 profile is required for this host.', status);
    const snapshot = new Uint8Array(112);
    for (let page = 0; page < 2; page++) {
      const raw = payload64(await this.exchange('diagnostics', updateCommand(7, page), signal), 'diagnostics');
      requireCondition(ascii(raw.subarray(0, 4)) === 'SPDG' && new DataView(raw.buffer).getUint32(4, true) === page,
        'diagnostics', 'diagnostic-page', 'Diagnostic reply has the wrong signature or page index.');
      snapshot.set(raw.subarray(8), page * 56);
    }
    const view = new DataView(snapshot.buffer);
    const diagnostics = { headerHex: hex(snapshot.subarray(0, 32)), bfptHex: hex(snapshot.subarray(32, 76)),
      ...Object.fromEntries(DIAGNOSTIC_FIELDS.map((name, index) => [name, view.getUint32(76 + index * 4, true)])) } as UpdateDiagnostics;
    requireCondition(diagnostics.phase === 5 && diagnostics.bfpt_dwords === 9 && diagnostics.bfpt_pointer === 0x30 &&
      diagnostics.legacy_profile === 1 && diagnostics.jedec === 0xc22016 && diagnostics.flash_status === 0x40 &&
      diagnostics.flash_error === 0 && diagnostics.flash_ready === 1 && diagnostics.reserved === 0 &&
      diagnostics.headerHex === EXPECTED_HEADER && diagnostics.bfptHex === EXPECTED_BFPT,
      'diagnostics', 'sfdp-profile', 'The fixed diagnostic pages do not match the accepted measured legacy profile.', diagnostics);
    // The one-shot selector must be consumed; a separate normal report seals preflight.
    const separate = await this.status('preflight', signal);
    matchingStatus(separate, profile, before.build_marker, 'preflight'); idleStatus(separate, 'preflight');
    requireCondition(separate.flash_ready === 1 && separate.jedec === 0xc22016 && separate.flash_status === 0x40,
      'preflight', 'probe-changed', 'The chip/profile status changed after diagnostics.', separate);
    return { profile, status: separate, diagnostics,
      geometry: { capacityBytes: 0x400000, pageBytes: 256, sectorBytes: 4096, app1Offset: 0x80000,
        maximumImageBytes: profile.maximum,
        evidence: 'Firmware phase5 follows exact FCB signature/capacity/page/sector and SFDP checks; FCB bytes are not exposed by this protocol.' } };
  }

  update(candidate: Uint8Array, options: VirtualUpdateOptions): Promise<VirtualUpdateReceipt> {
    return this.exclusive(async () => {
      const phases: UpdateProgress[] = [];
      const image = new Uint8Array(candidate);
      const pinnedMarker = options.expectedMarker;
      const target = VIRTUAL_WRITER_PROFILES.find(profile => profile.markers.includes(pinnedMarker));
      requireCondition(target, 'image', 'target-writer', 'The target marker requires an exact supported R13/R14/R15 writer contract.');
      requireCondition(typeof options.expectedSha256 === 'string' && /^[a-f0-9]{64}$/i.test(options.expectedSha256),
        'image', 'image-hash', 'Pin the candidate with its complete SHA256 before virtual upload.');
      requireCondition(image.length >= 0x800 && image.length <= 65536 && image.length % 4 === 0,
        'image', 'image-size', 'The matched ABI1 writer accepts aligned APP1 images of 2048..65536 bytes.');
      const view = new DataView(image.buffer);
      const word = (offset: number) => view.getUint32(offset, true);
      requireCondition(ascii(image.subarray(0x200, 0x208)) === 'SPUAFW10' && word(0x208) === 1 &&
        word(0x20c) === image.length && word(0x210) === 0x80000000 && word(0x214) >= 0x400 &&
        word(0x214) <= image.length - 0x400 && word(0x218) === 0x400 && word(0x21c) === 0x20243000 && word(0x400) === 0x20243000,
        'image', 'image-format', 'Candidate metadata, runtime bounds or stack do not match the exact ABI1 writer contract.');
      requireCondition(globalThis.crypto?.subtle, 'image', 'hash-unavailable', 'WebCrypto SHA256 is unavailable in this virtual host.');
      this.abort(options.signal, 'image');
      const sha256 = hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', image)));
      requireCondition(sha256 === options.expectedSha256.toLowerCase(), 'image', 'image-hash', 'The candidate bytes differ from the pinned SHA256.', { expected: options.expectedSha256, actual: sha256 });
      const crc32 = updateCrc32(image), paddedLength = (image.length + 4095) & ~4095;
      const imageReceipt = { sha256, crc32, length: image.length, paddedLength, expectedMarker: pinnedMarker };
      const progress = (phase: UpdateProgress['phase'], completedBytes: number) => {
        const event = { phase, completedBytes, totalBytes: image.length }; phases.push(event);
        options.onProgress?.({ ...event });
      };
      progress('image', 0);
      const before = await this.status('preflight', options.signal);
      const profile = profileFor(before, 'preflight'); idleStatus(before, 'preflight');
      if (options.expectedRunningMarker !== undefined) requireCondition(before.build_marker === options.expectedRunningMarker,
        'preflight', 'running-marker', 'The running firmware marker differs from the pinned writer.', before);
      const beforeSnapshot = await this.operation('preflight', () => this.bridge.snapshot(), options.signal);
      healthySnapshot(beforeSnapshot, 'preflight', before.build_marker);
      const preflight = await this.probe(before, profile, options.signal);
      progress('preflight', 0);
      const checksum = new Uint8Array(4); new DataView(checksum.buffer).setUint32(0, crc32, true);
      let status = decodeStatus(await this.exchange('upload', updateCommand(1, image.length, checksum), options.signal), 'upload');
      matchingStatus(status, profile, before.build_marker, 'upload'); healthy(status, 'upload');
      requireCondition(status.state === 1 && status.length === image.length && status.received === 0 && status.crc32 === 0,
        'upload', 'begin-result', 'BEGIN did not start the exact candidate transaction.', status);
      for (let offset = 0; offset < image.length; offset += 56) {
        const chunk = image.subarray(offset, offset + 56);
        status = decodeStatus(await this.exchange('upload', updateCommand(2, offset, chunk, chunk.length), options.signal), 'upload');
        matchingStatus(status, profile, before.build_marker, 'upload'); healthy(status, 'upload');
        requireCondition(status.state === 1 && status.length === image.length && status.received === offset + chunk.length,
          'upload', 'chunk-result', 'DATA did not acknowledge the exact ordered byte count.', status);
        progress('upload', offset + chunk.length);
      }
      const ramVerified = decodeStatus(await this.exchange('ram-verified', updateCommand(3), options.signal), 'ram-verified');
      matchingStatus(ramVerified, profile, before.build_marker, 'ram-verified'); healthy(ramVerified, 'ram-verified');
      requireCondition(ramVerified.state === 2 && ramVerified.length === image.length && ramVerified.received === image.length && ramVerified.crc32 === crc32 && ramVerified.flash_ready === 1,
        'ram-verified', 'ram-result', 'FINISH did not verify both transport CRC and the reread of staged RAM.', ramVerified);
      progress('ram-verified', image.length);
      status = decodeStatus(await this.exchange('commit', updateCommand(6, (crc32 ^ 0x46534c48) >>> 0), options.signal), 'commit');
      progress('commit', image.length);
      let completed = false;
      for (let poll = 0; poll <= this.options.maximumFlashPolls; poll++) {
        matchingStatus(status, profile, before.build_marker, 'flash'); healthy(status, 'flash');
        requireCondition(status.length === image.length && status.received === image.length && status.crc32 === crc32,
          'flash', 'commit-image', 'Commit status no longer identifies the verified candidate.', status);
        if (status.state === 6) { completed = true; break; }
        requireCondition(status.state === 4 || status.state === 5, 'flash', 'commit-state', 'Firmware did not queue or execute the accepted flash operation.', status);
        if (poll === this.options.maximumFlashPolls) break;
        status = await this.status('flash', options.signal);
      }
      requireCondition(completed, 'flash', 'flash-timeout', 'No device full-sector verification result arrived; reset and boot verification were not attempted.', status);
      const verifyFlash = (result: UpdateStatus, phase: string) => {
        matchingStatus(result, profile, before.build_marker, phase); healthy(result, phase);
        requireCondition(result.state === 6 && result.length === image.length && result.received === image.length && result.crc32 === crc32 &&
          result.flash_crc32 === crc32 && result.programmed === paddedLength && result.flash_ready === 1 && result.jedec === 0xc22016 && result.flash_status === 0x40,
          phase, 'flash-result', 'Flash status does not prove the exact full padded-sector comparison completed.', result);
      };
      const flashVerified = status; verifyFlash(flashVerified, 'flash'); progress('flash-verified', image.length);
      const separateStatus = await this.status('separate-status', options.signal);
      verifyFlash(separateStatus, 'separate-status'); progress('separate-status', image.length);
      const beforeResetSnapshot = await this.operation('separate-status', () => this.bridge.snapshot(), options.signal);
      healthySnapshot(beforeResetSnapshot, 'separate-status', before.build_marker, beforeSnapshot.firmwareHash);
      progress('reset', image.length);
      await this.operation('reset', () => this.bridge.reset(), options.signal);
      const bootStatus = await this.status('boot', options.signal);
      matchingStatus(bootStatus, target, pinnedMarker, 'boot'); idleStatus(bootStatus, 'boot');
      requireCondition(bootStatus.flash_ready === 0 && bootStatus.jedec === 0 && bootStatus.flash_status === 0,
        'boot', 'boot-not-fresh', 'USB still contains the previous completed/probed state; a fresh guest boot is required.', bootStatus);
      const snapshot = await this.operation('boot', () => this.bridge.snapshot(), options.signal);
      healthySnapshot(snapshot, 'boot', pinnedMarker, sha256);
      progress('boot-verified', image.length);
      return { scope: 'virtual APP1 update', image: imageReceipt, before, beforeSnapshot, preflight, ramVerified, flashVerified, separateStatus, beforeResetSnapshot,
        flashReadback: { verifiedBytes: paddedLength, imageCrc32: crc32, tail: 'FF',
          evidence: 'State6/error0 follows firmware byte comparison of every occupied padded sector through FlexSPI IP reads; flash_crc32 is the image CRC after that comparison, not a separate padded CRC.' },
        bootStatus, snapshot, phases };
    });
  }
}
