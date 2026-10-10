import {B2, B2DeliveryError, B2TransportError, B2ReadOnlyProbeError} from './model.ts';
import type {B2ImageBundle, ImageRole, ImagePin, HidCollectionInfo, BrowserHidDevice, B2Status, BrowserHidApi, ConnectOptions, ReadOnlyProbeOptions, OperationOptions, B2Progress, B2Preflight, B2ReadOnlyProbe, B2StorageResult, DeliveryStage} from './model.ts';
import {resolveAdmittedImage as getImage} from './resolve-image.ts';
import {crc32, ownedBytes} from './data.ts';
export * from './model.ts';

const APP1_OPCODES = new Set([1, 2, 3, 5, 6]);
const FEATURE_FIELDS = [
  "version", "state", "error", "length", "received", "crc32", "maximum",
  "capabilities", "jedec", "flashStatus", "flashError", "programmed",
  "flashReady", "flashCrc32", "buildMarker",
] as const;
const preflightTokens = new WeakMap<object, {
  readonly session: B2WriterSession;
  readonly bundle: B2ImageBundle;
  readonly role: ImageRole;
  readonly createdAt: number;
}>();

function flattenCollections(collections: readonly HidCollectionInfo[]): HidCollectionInfo[] {
  const result: HidCollectionInfo[] = [];
  const pending = [...collections];
  while (pending.length) {
    const collection = pending.pop()!;
    result.push(collection);
    if (collection.children) pending.push(...collection.children);
  }
  return result;
}

function verifyDeviceDescriptor(device: BrowserHidDevice): void {
  if (device.vendorId !== B2.vendorId || device.productId !== B2.productId || device.productName !== B2.productName) {
    throw new B2TransportError("Selected HID device is not the identified SP404 USB BRIDGE B2");
  }
  const matches = flattenCollections(device.collections).filter((collection) =>
    collection.usagePage === B2.usagePage && collection.usage === B2.usage,
  );
  if (matches.length !== 1) throw new B2TransportError("B2 vendor usage collection is missing or ambiguous");
  const reports = matches[0].featureReports.filter((report) => report.reportId === B2.reportId);
  if (reports.length !== 1) throw new B2TransportError("B2 report-ID-0 feature report is missing or ambiguous");
  const bits = reports[0].items.reduce((total, item) => total + item.reportSize * item.reportCount, 0);
  if (bits !== B2.reportBytes * 8) throw new B2TransportError("B2 feature report is not the verified 64-byte report body");
}

function parseStatus(view: DataView): B2Status {
  if (!(view instanceof DataView) || view.byteLength !== B2.reportBytes) {
    throw new B2TransportError("WebHID returned a status body with the wrong length");
  }
  const raw = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (raw[0] !== 0x53 || raw[1] !== 0x50 || raw[2] !== 0x31 || raw[3] !== 0x37) {
    throw new B2TransportError("WebHID status does not begin with SP17");
  }
  const result: Record<string, number> = {};
  for (let i = 0; i < FEATURE_FIELDS.length; i += 1) result[FEATURE_FIELDS[i]] = view.getUint32(4 + i * 4, true);
  return Object.freeze(result) as unknown as B2Status;
}

function checkIdentity(status: B2Status): void {
  if (status.version !== B2.protocol || status.maximum !== B2.maximum ||
      status.capabilities !== B2.capabilities || status.buildMarker !== B2.marker) {
    throw new B2TransportError("Running HID endpoint does not match the qualified B2 writer contract");
  }
  if (status.error !== 0 || status.flashError !== 0 || status.state === 7) {
    throw new B2TransportError("B2 status reports a writer or flash error; preserve its state");
  }
}

function requireIdle(status: B2Status, phase: string): void {
  checkIdentity(status);
  if (status.state !== 0 || status.length !== 0 || status.received !== 0 || status.crc32 !== 0 ||
      status.programmed !== 0 || status.flashCrc32 !== 0) {
    throw new B2TransportError(`${phase} requires a fresh idle B2 writer with zero transaction counters`);
  }
}

function requireProfile(status: B2Status, phase: string): void {
  checkIdentity(status);
  if (status.jedec !== B2.jedec || status.flashStatus !== B2.flashStatus ||
      status.flashReady !== B2.flashReady || status.flashError !== 0) {
    throw new B2TransportError(`${phase} did not confirm the qualified C22016/status-40 flash profile`);
  }
}

function requireCompleted(status: B2Status, image: ImagePin, expectedCrc: number, phase: string): void {
  checkIdentity(status);
  const expected: Partial<B2Status> = {
    state: 6,
    length: image.bytes,
    received: image.bytes,
    crc32: expectedCrc,
    jedec: B2.jedec,
    flashStatus: B2.flashStatus,
    flashError: 0,
    programmed: image.padded_bytes,
    flashReady: B2.flashReady,
    flashCrc32: expectedCrc,
  };
  for (const [key, value] of Object.entries(expected) as [keyof B2Status, number][]) {
    if (status[key] !== value) throw new B2TransportError(`${phase} does not match ${key}`);
  }
}

function makeCommand(opcode: number, argument = 0, payload: Uint8Array = new Uint8Array(), length = 0): Uint8Array<ArrayBuffer> {
  if (!APP1_OPCODES.has(opcode)) throw new TypeError("The browser writer exposes only probe/upload/verify/commit opcodes");
  if (!Number.isInteger(argument) || argument < 0 || argument > 0xffffffff ||
      !Number.isInteger(length) || length < 0 || length > B2.payloadBytes || length !== payload.byteLength) {
    throw new TypeError("B2 feature command fields exceed their fixed report bounds");
  }
  const report = new Uint8Array(B2.reportBytes);
  report[0] = opcode;
  report[1] = 1;
  report[2] = length;
  report[3] = 0;
  new DataView(report.buffer).setUint32(4, argument, true);
  report.set(payload, 8);
  return report;
}

function monotonicNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("B2 USB operation was aborted", "AbortError");
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class B2WriterSession {
  #provider: BrowserHidApi;
  #device: BrowserHidDevice;
  #callTimeoutMs: number;
  #terminal = false;
  #closed = false;
  #consumed = false;
  #disconnected = false;
  #disconnectListener: (event: { readonly device?: BrowserHidDevice }) => void;

  private constructor(provider: BrowserHidApi, device: BrowserHidDevice, callTimeoutMs: number) {
    this.#provider = provider;
    this.#device = device;
    this.#callTimeoutMs = callTimeoutMs;
    this.#disconnectListener = (event) => {
      if (event.device === this.#device) {
        this.#disconnected = true;
        this.#terminate();
      }
    };
    provider.addEventListener("disconnect", this.#disconnectListener);
  }

  static async open(provider: BrowserHidApi, device: BrowserHidDevice, callTimeoutMs: number): Promise<B2WriterSession> {
    const session = new B2WriterSession(provider, device, callTimeoutMs);
    try {
      await session.#call("open", () => device.open(), undefined, callTimeoutMs, true, () => {
        if (device.opened) void device.close().catch(() => undefined);
      });
      const status = await session.#readStatus();
      requireIdle(status, "Initial B2 connection");
      return session;
    } catch (error) {
      session.#terminate();
      throw error;
    }
  }

  get terminal(): boolean {
    return this.#closed || this.#terminal || this.#disconnected;
  }

  get consumed(): boolean {
    return this.#consumed;
  }

  #assertActive(requireOpen = true): void {
    if (this.#closed || this.#terminal || this.#disconnected) {
      throw new B2TransportError("B2 session is closed or terminal; request a fresh device connection");
    }
    if (requireOpen && !this.#device.opened) throw new B2TransportError("B2 HID connection is not open");
  }

  #terminate(): void {
    if (this.#terminal) return;
    this.#terminal = true;
    this.#provider.removeEventListener("disconnect", this.#disconnectListener);
    if (this.#device.opened) void this.#device.close().catch(() => undefined);
  }

  async #call<T>(
    label: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
    timeoutMs = this.#callTimeoutMs,
    allowClosedDevice = false,
    onLateSuccess?: () => void,
  ): Promise<T> {
    this.#assertActive(!allowClosedDevice);
    assertNotAborted(signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let abandoned = false;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abandoned = true;
          reject(new B2TransportError(`B2 HID ${label} exceeded its ${timeoutMs} ms bound`));
        }, timeoutMs);
      });
      const aborted = new Promise<never>((_, reject) => {
        if (!signal) return;
        onAbort = () => { abandoned = true; reject(abortError(signal)); };
        signal.addEventListener("abort", onAbort, { once: true });
      });
      const operation = Promise.resolve().then(action).then((value) => {
        if (abandoned && onLateSuccess) {
          try { onLateSuccess(); } catch { /* Late cleanup cannot resume this terminal session. */ }
        }
        return value;
      });
      const value = await Promise.race([operation, timeout, aborted]);
      this.#assertActive(!allowClosedDevice);
      assertNotAborted(signal);
      return value;
    } catch (error) {
      abandoned = true;
      this.#terminate();
      throw error instanceof Error ? error : new B2TransportError(`B2 HID ${label} failed`, { cause: error });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  async #readStatus(signal?: AbortSignal, timeoutMs = this.#callTimeoutMs): Promise<B2Status> {
    const view = await this.#call("status read", () => this.#device.receiveFeatureReport(B2.reportId), signal, timeoutMs);
    const status = parseStatus(view);
    checkIdentity(status);
    return status;
  }

  async #send(opcode: number, argument = 0, payload: Uint8Array = new Uint8Array(), length = 0, signal?: AbortSignal, timeoutMs = this.#callTimeoutMs): Promise<void> {
    const data = makeCommand(opcode, argument, payload, length);
    await this.#call("feature write", () => this.#device.sendFeatureReport(B2.reportId, data), signal, timeoutMs);
  }

  async #probeProfileReadOnly(
    signal?: AbortSignal,
    onProgress?: OperationOptions["onProgress"],
    totalBytes = 0,
    onProbeOpcodeAttempt?: () => void,
  ): Promise<B2Status> {
    const initial = await this.#readStatus(signal);
    requireIdle(initial, "Read-only B2 profile probe");
    onProbeOpcodeAttempt?.();
    await this.#send(5, 0, new Uint8Array(), 0, signal);
    const deadline = monotonicNow() + this.#callTimeoutMs;
    let probed: B2Status;
    while (true) {
      const remaining = Math.max(1, Math.floor(deadline - monotonicNow()));
      probed = await this.#readStatus(signal, Math.min(this.#callTimeoutMs, remaining));
      if (probed.flashReady === B2.flashReady) break;
      if (probed.state !== 0 || probed.flashError !== 0 || monotonicNow() >= deadline) {
        throw new B2TransportError("B2 chip/profile probe failed or timed out; no APP1 bytes were sent");
      }
      onProgress?.({ stage: "preflight", completedBytes: 0, totalBytes });
      await delay(50, signal);
    }
    requireProfile(probed, "B2 chip/profile probe");
    if (probed.state !== 0 || probed.length !== 0 || probed.received !== 0 || probed.programmed !== 0 || probed.flashCrc32 !== 0) {
      throw new B2TransportError("B2 chip/profile probe changed idle transaction counters");
    }
    return probed;
  }

  async #reopen(signal?: AbortSignal): Promise<void> {
    await this.#call("close before separate status", () => this.#device.close(), signal, this.#callTimeoutMs, true);
    if (this.#disconnected) throw new B2TransportError("B2 device disconnected before the separate status read");
    await this.#call("fresh HID reopen", () => this.#device.open(), signal, this.#callTimeoutMs, true, () => {
      if (this.#device.opened) void this.#device.close().catch(() => undefined);
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#device.opened && !this.#terminal && !this.#disconnected) {
      try {
        await this.#call("close", () => this.#device.close(), undefined, this.#callTimeoutMs, true);
      } catch (error) {
        this.#terminal = true;
        this.#closed = true;
        throw error;
      }
    }
    this.#closed = true;
    this.#provider.removeEventListener("disconnect", this.#disconnectListener);
  }

  async probeReadOnly(signal?: AbortSignal): Promise<B2ReadOnlyProbe> {
    this.#assertActive();
    if (this.#consumed) throw new B2TransportError("This B2 session already attempted an operation");
    this.#consumed = true;
    let probeOpcodeMayHaveBeenSent = false;
    try {
      const status = await this.#probeProfileReadOnly(signal, undefined, 0, () => { probeOpcodeMayHaveBeenSent = true; });
      return Object.freeze({
        schema: "opensp-b2-browser-read-only-probe",
        version: 1,
        status: "idle-b2-profile-confirmed",
        device: Object.freeze({
          vendorId: this.#device.vendorId,
          productId: this.#device.productId,
          productName: this.#device.productName,
          usagePage: B2.usagePage,
          usage: B2.usage,
          reportId: B2.reportId,
          reportBytes: B2.reportBytes,
        }),
        writer: Object.freeze({
          marker: status.buildMarker,
          protocol: status.version,
          maximum: status.maximum,
          capabilities: status.capabilities,
        }),
        flashProfile: Object.freeze({
          jedec: status.jedec,
          status: status.flashStatus,
          ready: status.flashReady,
          error: status.flashError,
        }),
        transaction: Object.freeze({
          state: 0,
          error: 0,
          length: 0,
          received: 0,
          crc32: 0,
          programmed: 0,
          flashCrc32: 0,
        }),
        commandOpcodes: Object.freeze([5] as const),
        app1BytesSent: 0,
        programOrEraseCommandsSent: false,
      });
    } catch (error) {
      this.#terminate();
      const message = error instanceof Error ? error.message : "B2 read-only profile probe failed";
      throw new B2ReadOnlyProbeError(
        message,
        probeOpcodeMayHaveBeenSent ? "profile-probe" : "initial-status",
        probeOpcodeMayHaveBeenSent,
        error,
      );
    }
  }

  async preflight(bundle: B2ImageBundle, role: ImageRole, signal?: AbortSignal, onProgress?: OperationOptions["onProgress"]): Promise<B2Preflight> {
    this.#assertActive();
    if (this.#consumed) throw new B2TransportError("This B2 session already attempted an update");
    try {
      const image = getImage(bundle, role);
      const probed = await this.#probeProfileReadOnly(signal, onProgress, image.pin.bytes);
      const result: B2Preflight = Object.freeze({
        role,
        imageSha256: image.pin.sha256,
        imageBytes: image.pin.bytes,
        paddedBytes: image.pin.padded_bytes,
        sectors: image.pin.sectors,
        writerMarker: probed.buildMarker,
        jedec: probed.jedec,
        flashStatus: probed.flashStatus,
      });
      preflightTokens.set(result, { session: this, bundle, role, createdAt: monotonicNow() });
      return result;
    } catch (error) {
      this.#terminate();
      throw error;
    }
  }

  async write(bundle: B2ImageBundle, role: ImageRole, preflight: B2Preflight, options: OperationOptions = {}): Promise<B2StorageResult> {
    const token = preflightTokens.get(preflight);
    if (!token || token.session !== this || token.bundle !== bundle || token.role !== role) {
      throw new B2TransportError("Write requires this session's fresh preflight for the exact admitted image");
    }
    if (monotonicNow() - token.createdAt > 30_000) throw new B2TransportError("B2 preflight expired; run the read-only probe again");
    if (this.#consumed) throw new B2TransportError("B2 session is single-use; reconnect after this update attempt");
    this.#consumed = true;
    preflightTokens.delete(preflight);
    const image = getImage(bundle, role);
    const { signal, onProgress } = options;
    let stage: DeliveryStage = "ram-begin";
    let commitMayHaveBeenAccepted = false;
    let deviceReadbackReported = false;
    let separateStatusVerified = false;
    const crc = crc32(image.bytes);
    try {
      assertNotAborted(signal);
      const before = await this.#readStatus(signal);
      requireIdle(before, "Upload admission");
      requireProfile(before, "Upload admission");

      stage = "ram-begin";
      const crcPayload = new Uint8Array(4);
      new DataView(crcPayload.buffer).setUint32(0, crc, true);
      await this.#send(1, image.bytes.byteLength, crcPayload, 4, signal);

      stage = "ram-transfer";
      let nextProgress = 65_536;
      for (let offset = 0; offset < image.bytes.byteLength; offset += B2.payloadBytes) {
        const chunk = image.bytes.subarray(offset, Math.min(offset + B2.payloadBytes, image.bytes.byteLength));
        await this.#send(2, offset, chunk, chunk.byteLength, signal);
        const received = offset + chunk.byteLength;
        if (received >= nextProgress || received === image.bytes.byteLength) {
          const status = await this.#readStatus(signal);
          requireProfile(status, "RAM transfer");
          if (status.state !== 1 || status.length !== image.bytes.byteLength || status.received !== received) {
            throw new B2TransportError("B2 RAM transfer counters differ from the exact image bytes sent");
          }
          onProgress?.({ stage: "ram-upload", completedBytes: received, totalBytes: image.bytes.byteLength });
          nextProgress += 65_536;
        }
      }

      stage = "ram-crc";
      await this.#send(3, 0, new Uint8Array(), 0, signal);
      const ram = await this.#readStatus(signal);
      requireProfile(ram, "Staged RAM CRC");
      if (ram.state !== 2 || ram.length !== image.bytes.byteLength || ram.received !== image.bytes.byteLength || ram.crc32 !== crc) {
        throw new B2TransportError("B2 staged-RAM CRC did not match the admitted image");
      }
      onProgress?.({ stage: "ram-verified", completedBytes: image.bytes.byteLength, totalBytes: image.bytes.byteLength });

      stage = "flash-commit";
      assertNotAborted(signal);
      commitMayHaveBeenAccepted = true;
      await this.#send(6, (crc ^ 0x46534c48) >>> 0, new Uint8Array(), 0, signal);

      stage = "sector-readback";
      const totalTimeout = Math.max(120_000, image.pin.sectors * 3_000);
      const deadline = monotonicNow() + totalTimeout;
      let previousProgress = 0;
      let lastProgressAt = monotonicNow();
      let completedStatus: B2Status;
      while (true) {
        const remaining = Math.max(1, Math.floor(deadline - monotonicNow()));
        const stored = await this.#readStatus(signal, Math.min(this.#callTimeoutMs, remaining));
        if ((stored.programmed % B2.sectorBytes) !== 0 || stored.programmed < previousProgress ||
            stored.programmed > image.pin.padded_bytes) {
          throw new B2TransportError("B2 sector readback progress is misaligned, regressing or outside the padded extent");
        }
        if (stored.programmed !== previousProgress) {
          previousProgress = stored.programmed;
          lastProgressAt = monotonicNow();
          onProgress?.({ stage: "flash-readback", completedBytes: stored.programmed, totalBytes: image.pin.padded_bytes });
        }
        if (stored.state === 6) {
          requireCompleted(stored, image.pin, crc, "B2 full padded sector readback");
          completedStatus = stored;
          deviceReadbackReported = true;
          break;
        }
        if (stored.state !== 4 && stored.state !== 5) {
          throw new B2TransportError("B2 flash worker left its expected commit/readback states");
        }
        const now = monotonicNow();
        if (now >= deadline || now - lastProgressAt > 30_000) {
          throw new B2TransportError("B2 sector readback timed out; preserve device state and do not retry");
        }
        await delay(100, signal);
      }

      stage = "separate-status";
      onProgress?.({ stage: "separate-status", completedBytes: image.pin.padded_bytes, totalBytes: image.pin.padded_bytes });
      await this.#reopen(signal);
      const separate = await this.#readStatus(signal);
      requireCompleted(separate, image.pin, crc, "Separately reopened B2 status");
      separateStatusVerified = true;
      await this.close();
      return Object.freeze({
        status: "storage-readback-verified",
        image: image.pin,
        writer: Object.freeze({
          marker: separate.buildMarker,
          protocol: separate.version,
          jedec: separate.jedec,
          flashStatus: separate.flashStatus,
          flashReady: separate.flashReady,
        }),
        observedStatuses: Object.freeze({ before, ram, stored: completedStatus!, separate }),
        readback: Object.freeze({
          source: "device-reported-sector-readback",
          verifiedPaddedBytes: separate.programmed,
          sectors: image.pin.sectors,
          separateStatus: "verified-after-close-and-reopen",
          sameAuthorizedDeviceObject: true,
          hostDownloadedFlashBytes: false,
        }),
        reboot: Object.freeze({
          normalBoot: "not-confirmed",
          coldDel: "not-confirmed",
          expectedNormalIdentity: image.pin.expected_normal_identity,
          expectedColdDelMarker: image.pin.expected_cold_del_marker,
        }),
      });
    } catch (error) {
      this.#terminate();
      if (error instanceof B2DeliveryError) throw error;
      const message = error instanceof Error ? error.message : "B2 update failed";
      throw new B2DeliveryError(message, stage, commitMayHaveBeenAccepted, deviceReadbackReported, separateStatusVerified, error);
    }
  }
}

export async function connectB2Writer(options: ConnectOptions = {}): Promise<B2WriterSession> {
  const browser = globalThis as typeof globalThis & {
    readonly isSecureContext?: boolean;
    readonly navigator?: Navigator & { readonly hid?: BrowserHidApi };
  };
  const provider = options.hid ?? browser.navigator?.hid;
  const secure = options.secureContext ?? browser.isSecureContext === true;
  if (!secure) throw new B2TransportError("B2 USB requires a secure browser context (HTTPS or localhost)");
  if (!provider || typeof provider.requestDevice !== "function") {
    throw new B2TransportError("This browser does not provide WebHID; use a supported Chromium-based desktop browser");
  }
  if (typeof provider.addEventListener !== "function" || typeof provider.removeEventListener !== "function") {
    throw new B2TransportError("WebHID disconnect events are unavailable in this browser context");
  }
  const timeout = options.callTimeoutMs ?? 10_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 10_000) throw new TypeError("HID call timeout must be 1..10000 ms");
  const devices = await provider.requestDevice({
    filters: [{
      vendorId: B2.vendorId,
      productId: B2.productId,
      usagePage: B2.usagePage,
      usage: B2.usage,
    }],
  });
  if (devices.length !== 1) throw new B2TransportError("Select exactly one currently connected B2 writer in the browser device picker");
  const device = devices[0];
  verifyDeviceDescriptor(device);
  return B2WriterSession.open(provider, device, timeout);
}

/** Connect through the owner-visible picker, read status, send opcode 5 only, and close. */
export async function probeB2WriterReadOnly(options: ReadOnlyProbeOptions = {}): Promise<B2ReadOnlyProbe> {
  let session: B2WriterSession;
  try {
    session = await connectB2Writer(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to connect to the B2 writer";
    throw new B2ReadOnlyProbeError(message, "connect", false, error);
  }
  try {
    const result = await session.probeReadOnly(options.signal);
    try {
      await session.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : "B2 connection did not close cleanly";
      throw new B2ReadOnlyProbeError(message, "close", true, error);
    }
    return result;
  } catch (error) {
    try { await session.close(); } catch { /* Preserve the first probe outcome. */ }
    throw error;
  }
}

export async function preflightB2Writer(
  session: B2WriterSession,
  bundle: B2ImageBundle,
  role: ImageRole,
  options: OperationOptions = {},
): Promise<B2Preflight> {
  return session.preflight(bundle, role, options.signal, options.onProgress);
}

export async function writeB2Image(
  session: B2WriterSession,
  bundle: B2ImageBundle,
  role: ImageRole,
  preflight: B2Preflight,
  options: OperationOptions = {},
): Promise<B2StorageResult> {
  return session.write(bundle, role, preflight, options);
}
