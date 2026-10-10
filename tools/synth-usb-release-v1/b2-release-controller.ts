import {connectB2Writer, preflightB2Writer, writeB2Image, B2DeliveryError} from './b2-driver.ts';
import type {B2WriterSession, B2ImageBundle, ImageRole, ImagePin, ConnectOptions, B2Progress, B2StorageResult} from './b2-driver.ts';
import {resolveAdmittedImage} from './resolve-image.ts';

type Phase = 'ready' | 'connecting' | 'profile-confirmed' | 'writing' | 'reboot-pending' | 'terminal';
const now = () => new Date().toISOString();

/** UI controller only. Admission, feature framing and flash verification remain in the pinned B2 modules. */
export class B2ReleaseUpdateController {
  readonly image: ImagePin;
  #bundle: B2ImageBundle;
  #role: ImageRole;
  #phase: Phase = 'ready';
  #session?: B2WriterSession;
  #abort?: AbortController;
  #cancelAllowed = false;
  #cancelRequested = false;
  #receipt?: Readonly<Record<string, unknown>>;
  #progress: Readonly<Record<string, unknown>>[] = [];

  constructor(admittedBundle: B2ImageBundle, role: ImageRole) {
    // The resolver's WeakMaps reject cloned tokens, flags, arbitrary files and withdrawn candidates.
    this.image = resolveAdmittedImage(admittedBundle, role).pin;
    this.#bundle = admittedBundle;
    this.#role = role;
  }

  get phase(): Phase { return this.#phase; }
  get cancelAvailable(): boolean { return this.#phase === 'writing' && this.#cancelAllowed && !this.#cancelRequested; }
  get receipt(): Readonly<Record<string, unknown>> | undefined { return this.#receipt; }

  /** Invoke directly from the owner's Connect action; never on page load or after an automatic retry. */
  async connect(options: ConnectOptions = {}) {
    if (this.#phase !== 'ready') throw new TypeError('Use a new controller and fresh writer status/profile after any attempt');
    this.#phase = 'connecting';
    try {
      this.#session = await connectB2Writer(options);
      const preflight = await preflightB2Writer(this.#session, this.#bundle, this.#role);
      this.#phase = 'profile-confirmed';
      return preflight;
    } catch (error) {
      this.#phase = 'terminal';
      this.#receipt = this.#failure(error, now(), 'connect', undefined);
      await this.#close();
      throw error;
    }
  }

  /** Cancels host transfer before the commit boundary. It does not reset or undo staged device RAM. */
  cancel(): boolean {
    if (!this.cancelAvailable) return false;
    this.#cancelRequested = true;
    this.#cancelAllowed = false;
    this.#abort!.abort(new DOMException('Owner cancelled B2 RAM transfer; preserve device state', 'AbortError'));
    return true;
  }

  /** A separate explicit Write action. Confirmation is not a source/admission or hardware qualification. */
  async write(confirmation: { explicitWrite: true; currentColdDelTitle: 'USB BRIDGE B2' },
              onProgress?: (progress: B2Progress) => void) {
    if (this.#phase !== 'profile-confirmed' || !this.#session) throw new TypeError('Connect and confirm a fresh B2 profile first');
    if (confirmation?.explicitWrite !== true || confirmation.currentColdDelTitle !== 'USB BRIDGE B2') {
      throw new TypeError('Explicit Write and the current DEL/B2 title report are required');
    }
    this.#phase = 'writing';
    this.#abort = new AbortController();
    this.#cancelAllowed = true;
    const startedAt = now();
    let storage: B2StorageResult | undefined;
    const reportProgress = (progress: B2Progress) => {
      // The unchanged driver calls ram-verified immediately before its possible commit.
      // Lock before notifying the UI, including synchronous callback cancellation attempts.
      if (['ram-verified', 'flash-readback', 'separate-status'].includes(progress.stage)) this.#cancelAllowed = false;
      this.#progress.push(Object.freeze({...progress, at: now()}));
      onProgress?.(progress);
    };
    try {
      const preflight = await preflightB2Writer(this.#session, this.#bundle, this.#role,
        {signal: this.#abort.signal, onProgress: reportProgress});
      storage = await writeB2Image(this.#session, this.#bundle, this.#role, preflight,
        {signal: this.#abort.signal, onProgress: reportProgress});
      this.#phase = 'reboot-pending';
      this.#receipt = Object.freeze({...this.#base(startedAt), completedAt: now(),
        status: 'storage-readback-verified-reboot-pending', storage});
      return this.#receipt;
    } catch (error) {
      this.#phase = 'terminal';
      this.#receipt = this.#failure(error, startedAt, 'preflight', storage);
      throw error;
    } finally {
      this.#cancelAllowed = false;
      await this.#close();
      this.#abort = undefined;
    }
  }

  /** Available after failure too. Keep the original error and device-returned statuses in the receipt. */
  downloadableReceipt(): {bytes: Uint8Array; filename: string} {
    if (!this.#receipt) throw new TypeError('No attempt receipt is available');
    return {bytes: new TextEncoder().encode(JSON.stringify(this.#receipt, null, 2) + '\n'),
      filename: `b2-release-${String(this.#receipt.startedAt).replace(/[^0-9TZ]/g, '')}.json`};
  }

  #base(startedAt: string) {
    return {schema: 'opensynth-b2-release-controller-attempt-v1', startedAt, image: this.image,
      progress: Object.freeze([...this.#progress]), cancelRequested: this.#cancelRequested,
      automaticRetryAllowed: false, normalBootConfirmed: false, coldDelConfirmed: false,
      candidateHardwareQualified: false, publicReleaseReady: false, deviceUntouchedClaimed: false,
      physicalTransportAuthenticatedByThisReceipt: false, hostFlashBytesDownloaded: false,
      nextRequiredChecks: ['full-power normal boot and exact title', 'candidate-specific owner acceptance',
        'separate full-power DEL boot and fresh idle B2 status/profile']};
  }

  #failure(error: unknown, startedAt: string, defaultStage: string, storage: B2StorageResult | undefined) {
    const delivery = error instanceof B2DeliveryError;
    return Object.freeze({...this.#base(startedAt), completedAt: now(), status: 'failed-preserve-device-state',
      failure: Object.freeze({name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error), stage: delivery ? error.stage : defaultStage,
        commitMayHaveBeenAccepted: delivery ? error.commitMayHaveBeenAccepted : false,
        deviceReadbackReported: delivery ? error.deviceReadbackReported : false,
        separateStatusVerified: delivery ? error.separateStatusVerified : false}), storage,
      freshConnectionIdentityProfileAndStatusRequired: true});
  }

  async #close() {
    if (!this.#session) return;
    try { await this.#session.close(); } catch { /* Keep the original outcome; no retry or reset. */ }
    this.#session = undefined;
  }
}
