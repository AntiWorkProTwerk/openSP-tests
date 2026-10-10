export const B2 = Object.freeze({
  vendorId: 0xcafe,
  productId: 0x4050,
  usagePage: 0xff00,
  usage: 1,
  productName: "SP404 USB BRIDGE B2",
  marker: 0x52420201,
  legacyMarker: 0x52420001,
  protocol: 2,
  maximum: 0x37f000,
  jedec: 0xc22016,
  flashStatus: 0x40,
  flashReady: 1,
  capabilities: 1,
  reportId: 0,
  reportBytes: 64,
  payloadBytes: 56,
  sectorBytes: 4096,
});

export type ImageRole = "candidate" | "restoration";
export type ImageFormat = "spuafw10-abi1" | "spuafw10-abi2";

export interface HidReportItem {
  readonly reportSize: number;
  readonly reportCount: number;
}

export interface HidReportInfo {
  readonly reportId: number;
  readonly items: readonly HidReportItem[];
}

export interface HidCollectionInfo {
  readonly usagePage: number;
  readonly usage: number;
  readonly featureReports: readonly HidReportInfo[];
  readonly children?: readonly HidCollectionInfo[];
}

export interface BrowserHidDevice {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: readonly HidCollectionInfo[];
  readonly opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  sendFeatureReport(reportId: number, data: BufferSource): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
}

export interface BrowserHidApi {
  requestDevice(options: {
    readonly filters: readonly [{
      readonly vendorId: number;
      readonly productId: number;
      readonly usagePage: number;
      readonly usage: number;
    }];
  }): Promise<readonly BrowserHidDevice[]>;
  addEventListener(type: "disconnect", listener: (event: { readonly device?: BrowserHidDevice }) => void): void;
  removeEventListener(type: "disconnect", listener: (event: { readonly device?: BrowserHidDevice }) => void): void;
}

export interface B2Status {
  readonly version: number;
  readonly state: number;
  readonly error: number;
  readonly length: number;
  readonly received: number;
  readonly crc32: number;
  readonly maximum: number;
  readonly capabilities: number;
  readonly jedec: number;
  readonly flashStatus: number;
  readonly flashError: number;
  readonly programmed: number;
  readonly flashReady: number;
  readonly flashCrc32: number;
  readonly buildMarker: number;
}

export interface LocalBinary {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ImagePin {
  readonly role: ImageRole;
  readonly format: ImageFormat;
  readonly abi: 1 | 2;
  readonly bytes: number;
  readonly sha256: string;
  readonly crc32: number;
  readonly padded_bytes: number;
  readonly sectors: number;
  readonly expected_normal_identity: string;
  readonly expected_cold_del_marker: number;
}

export interface B2ImageBundle {
  readonly restoration: ImagePin;
}

export interface ConnectOptions {
  /** Test seam. Production callers should omit this and use the browser picker. */
  readonly hid?: BrowserHidApi;
  /** Test seam. A normal site must use the actual secure-context value. */
  readonly secureContext?: boolean;
  /** May shorten the fixed ten-second HID-call bound, never extend it. */
  readonly callTimeoutMs?: number;
}

export interface ReadOnlyProbeOptions extends ConnectOptions {
  readonly signal?: AbortSignal;
}

export interface OperationOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: B2Progress) => void;
}

export interface B2Progress {
  readonly stage: "preflight" | "ram-upload" | "ram-verified" | "flash-readback" | "separate-status";
  readonly completedBytes: number;
  readonly totalBytes: number;
}

export interface B2Preflight {
  readonly role: ImageRole;
  readonly imageSha256: string;
  readonly imageBytes: number;
  readonly paddedBytes: number;
  readonly sectors: number;
  readonly writerMarker: number;
  readonly jedec: number;
  readonly flashStatus: number;
}

export interface B2ReadOnlyProbe {
  readonly schema: "opensp-b2-browser-read-only-probe";
  readonly version: 1;
  readonly status: "idle-b2-profile-confirmed";
  readonly device: {
    readonly vendorId: number;
    readonly productId: number;
    readonly productName: string;
    readonly usagePage: number;
    readonly usage: number;
    readonly reportId: 0;
    readonly reportBytes: 64;
  };
  readonly writer: {
    readonly marker: number;
    readonly protocol: number;
    readonly maximum: number;
    readonly capabilities: number;
  };
  readonly flashProfile: {
    readonly jedec: number;
    readonly status: number;
    readonly ready: number;
    readonly error: number;
  };
  readonly transaction: {
    readonly state: 0;
    readonly error: 0;
    readonly length: 0;
    readonly received: 0;
    readonly crc32: 0;
    readonly programmed: 0;
    readonly flashCrc32: 0;
  };
  readonly commandOpcodes: readonly [5];
  readonly app1BytesSent: 0;
  readonly programOrEraseCommandsSent: false;
}

export interface B2StorageResult {
  readonly status: "storage-readback-verified";
  readonly image: ImagePin;
  readonly writer: {
    readonly marker: number;
    readonly protocol: number;
    readonly jedec: number;
    readonly flashStatus: number;
    readonly flashReady: number;
  };
  readonly observedStatuses: {
    readonly before: B2Status;
    readonly ram: B2Status;
    readonly stored: B2Status;
    readonly separate: B2Status;
  };
  readonly readback: {
    readonly source: "device-reported-sector-readback";
    readonly verifiedPaddedBytes: number;
    readonly sectors: number;
    readonly separateStatus: "verified-after-close-and-reopen";
    readonly sameAuthorizedDeviceObject: true;
    readonly hostDownloadedFlashBytes: false;
  };
  readonly reboot: {
    readonly normalBoot: "not-confirmed";
    readonly coldDel: "not-confirmed";
    readonly expectedNormalIdentity: string;
    readonly expectedColdDelMarker: number;
  };
}

export type DeliveryStage =
  | "preflight"
  | "ram-begin"
  | "ram-transfer"
  | "ram-crc"
  | "flash-commit"
  | "sector-readback"
  | "separate-status";

export class B2DeliveryError extends Error {
  readonly stage: DeliveryStage;
  readonly commitMayHaveBeenAccepted: boolean;
  readonly deviceReadbackReported: boolean;
  readonly separateStatusVerified: boolean;
  readonly normalBootConfirmed = false;
  readonly coldDelConfirmed = false;

  constructor(
    message: string,
    stage: DeliveryStage,
    commitMayHaveBeenAccepted: boolean,
    deviceReadbackReported: boolean,
    separateStatusVerified: boolean,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "B2DeliveryError";
    this.stage = stage;
    this.commitMayHaveBeenAccepted = commitMayHaveBeenAccepted;
    this.deviceReadbackReported = deviceReadbackReported;
    this.separateStatusVerified = separateStatusVerified;
  }
}

export class B2TransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "B2TransportError";
  }
}

export type B2ReadOnlyProbeStage = "connect" | "initial-status" | "profile-probe" | "close";

export class B2ReadOnlyProbeError extends Error {
  readonly stage: B2ReadOnlyProbeStage;
  readonly probeOpcodeMayHaveBeenSent: boolean;
  readonly app1BytesSent = 0;
  readonly programOrEraseCommandsSent = false;

  constructor(message: string, stage: B2ReadOnlyProbeStage, probeOpcodeMayHaveBeenSent: boolean, cause?: unknown) {
    super(message, { cause });
    this.name = "B2ReadOnlyProbeError";
    this.stage = stage;
    this.probeOpcodeMayHaveBeenSent = probeOpcodeMayHaveBeenSent;
  }
}

