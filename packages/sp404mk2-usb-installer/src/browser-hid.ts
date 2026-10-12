import {B2_WEBHID, R50_WEBHID, assertB2Device, assertR50Device, type R50FeatureDevice} from './r50-webhid.ts';
import {R51_WEBHID, assertR51Device, type R51FeatureDevice} from './r51-webhid.ts';

export type HidRequestOptions = Readonly<{
  filters: ReadonlyArray<Readonly<{vendorId: number; productId: number; usagePage: number; usage: number}>>;
}>;

export interface BrowserHid {
  requestDevice(options: HidRequestOptions): Promise<ReadonlyArray<R50FeatureDevice>>;
  getDevices?(): Promise<ReadonlyArray<R50FeatureDevice>>;
}

export class BrowserHidError extends Error {
  readonly code: 'unsupported' | 'cancelled' | 'selection';
  constructor(code: BrowserHidError['code'], message: string) {
    super(message);
    this.name = 'BrowserHidError';
    this.code = code;
  }
}

/**
 * Request only the frozen R50 writer collection. The browser picker must be
 * reached directly from a user action; this function performs no device write.
 */
export async function requestR50Writer(hid: BrowserHid | undefined): Promise<R50FeatureDevice> {
  if (!hid) throw new BrowserHidError('unsupported', 'Direct USB installation needs Chrome or another desktop browser with WebHID. You can still download the checked firmware file.');
  let selected: ReadonlyArray<R50FeatureDevice>;
  try {
    selected = await hid.requestDevice({filters: [{
      vendorId: R50_WEBHID.vendorId,
      productId: R50_WEBHID.productId,
      usagePage: R50_WEBHID.usagePage,
      usage: R50_WEBHID.usage,
    }]});
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotFoundError') throw new BrowserHidError('cancelled', 'No R50 writer was selected. Nothing was written.');
    throw error;
  }
  if (selected.length !== 1) throw new BrowserHidError('selection', 'Select one SP404 STOCK FLASH R50 device. Nothing was written.');
  assertR50Device(selected[0]);
  return selected[0];
}

/** Request only the guarded R51 writer collection. This performs no device I/O. */
export async function requestR51Writer(hid: BrowserHid | undefined): Promise<R51FeatureDevice> {
  if (!hid) throw new BrowserHidError('unsupported', 'Direct USB installation needs Chrome or another desktop browser with WebHID. You can still download the checked firmware file.');
  let selected: ReadonlyArray<R51FeatureDevice>;
  try {
    selected = await hid.requestDevice({filters: [{
      vendorId: R51_WEBHID.vendorId,
      productId: R51_WEBHID.productId,
      usagePage: R51_WEBHID.usagePage,
      usage: R51_WEBHID.usage,
    }]});
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotFoundError') throw new BrowserHidError('cancelled', 'No R51 writer was selected. Nothing was written.');
    throw error;
  }
  if (selected.length !== 1) throw new BrowserHidError('selection', 'Select one SP404 STOCK FLASH R51 device. Nothing was written.');
  assertR51Device(selected[0]);
  return selected[0];
}

/** Return one already-authorized R51 without opening it or prompting the user. */
export async function getAuthorizedR51Writer(hid: BrowserHid | undefined): Promise<R51FeatureDevice | undefined> {
  if (!hid?.getDevices) return undefined;
  const selected = (await hid.getDevices()).filter(device => device.vendorId === R51_WEBHID.vendorId &&
    device.productId === R51_WEBHID.productId && device.productName === R51_WEBHID.productName &&
    device.collections?.some(collection => collection.usagePage === R51_WEBHID.usagePage && collection.usage === R51_WEBHID.usage));
  if (selected.length > 1) throw new BrowserHidError('selection', 'More than one authorized SP404 STOCK FLASH R51 device is connected.');
  if (!selected.length) return undefined;
  assertR51Device(selected[0]);
  return selected[0];
}

/** Request the retained B2 collection for the post-reboot, read-only check. */
export async function requestB2Writer(hid: BrowserHid | undefined): Promise<R50FeatureDevice> {
  if (!hid) throw new BrowserHidError('unsupported', 'The final B2 check needs Chrome or another desktop browser with WebHID.');
  let selected: ReadonlyArray<R50FeatureDevice>;
  try {
    selected = await hid.requestDevice({filters: [{
      vendorId: B2_WEBHID.vendorId,
      productId: B2_WEBHID.productId,
      usagePage: B2_WEBHID.usagePage,
      usage: B2_WEBHID.usage,
    }]});
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotFoundError') throw new BrowserHidError('cancelled', 'No B2 writer was selected. The completed flash receipt is unchanged.');
    throw error;
  }
  if (selected.length !== 1) throw new BrowserHidError('selection', 'Select one SP404 USB BRIDGE B2 device.');
  assertB2Device(selected[0]);
  return selected[0];
}
