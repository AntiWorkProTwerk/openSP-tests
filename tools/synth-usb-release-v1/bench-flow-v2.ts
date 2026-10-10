import {B2ReleaseUpdateController} from './b2-release-controller.ts';
import {probeB2WriterReadOnly} from './b2-driver.ts';
import type {ConnectOptions, OperationOptions} from './model.ts';
import type {AdmittedLocalBenchCandidate} from './local-bench-v1.ts';
import {resolveBenchImage} from './local-bench-v1.ts';
import {hexDigest, allowOnlyFields, record} from './data.ts';
import {ROOT_SOFTWARE_REVIEW_V2} from './root-review-v2.ts';

type Phase = 'ready'|'connecting'|'profile-confirmed'|'writing'|'reboot-pending'|'normal-owner-reported'|'cold-del-checking'|'completed-owner-and-browser-checks'|'terminal';
type OwnerNormal = {readonly fullPowerRemoval: true; readonly title: string; readonly knownSampleWorks: true; readonly synthWorks: true; readonly synthExitWorks: true; readonly stoppedPatternRecordingWorks: true; readonly chosenPadSavePlaybackWorks: true; readonly exactReply: string};
type OwnerDel = {readonly fullPowerRemoval: true; readonly title: 'USB BRIDGE B2'; readonly exactReply: string};
const requireValue = (value: unknown, message: string): void => {if(!value)throw new TypeError(message);};
const now = () => new Date().toISOString();

/** Post-boot evidence flow. The existing release controller owns transfer and cancellation. */
export class SingleTakeBenchUsbFlow {
  #admission: AdmittedLocalBenchCandidate;
  #controller: B2ReleaseUpdateController;
  #phase: Phase = 'ready';
  #receipt?: Readonly<Record<string, unknown>>;
  constructor(admission: AdmittedLocalBenchCandidate) {
    resolveBenchImage(admission, 'candidate');
    requireValue(admission.rootReviewContract.version === 2 && admission.rootReviewContract.firstOwnerTestScope === ROOT_SOFTWARE_REVIEW_V2.firstOwnerTestScope && admission.rootReviewContract.repeatQualified === false, 'The single-take flow requires an opaque V2-restricted admission');
    this.#admission = admission;
    this.#controller = new B2ReleaseUpdateController(admission, 'candidate');
  }
  get phase(): Phase {return this.#phase;}
  get receipt(): Readonly<Record<string, unknown>>|undefined {return this.#receipt;}
  get expectedNormalIdentity(): string {return this.#controller.image.expected_normal_identity;}
  get cancelAvailable(): boolean {return this.#phase === 'writing' && this.#controller.cancelAvailable;}
  cancel(): boolean {return this.#phase === 'writing' && this.#controller.cancel();}

  async connect(options: ConnectOptions = {}) {
    requireValue(this.#phase === 'ready', 'Start a fresh flow before requesting another connection');
    this.#phase = 'connecting';
    try {
      const profile = await this.#controller.connect(options);
      this.#phase = 'profile-confirmed';
      return profile;
    } catch(error) {
      this.#phase = 'terminal';
      this.#receipt = this.#controller.receipt;
      throw error;
    }
  }

  async write(confirmation: {readonly firstOwnerTest: true; readonly currentColdDelTitle: 'USB BRIDGE B2'}, options: OperationOptions = {}) {
    requireValue(this.#phase === 'profile-confirmed', 'Connect and confirm the B2 profile first');
    requireValue(confirmation?.firstOwnerTest === true && confirmation.currentColdDelTitle === 'USB BRIDGE B2', 'Explicit root-sealed first-owner-test write and current DEL title confirmation are required');
    this.#phase = 'writing';
    const startedAt = now(), attemptId = globalThis.crypto.randomUUID();
    const base = Object.freeze({schema:'opensp-synth-usb-delivery-attempt-v1', version:1, attemptId, startedAt,
      scope:this.#admission.scope, firstOwnerTestScope:ROOT_SOFTWARE_REVIEW_V2.firstOwnerTestScope,
      repeatQualified:false, persistenceQualified:false, duration120SecondsQualified:false,
      image:this.#admission.candidate, authenticatedEvidence:this.#admission.authenticatedEvidence,
      candidateUploadEnabled:true, candidateHardwareQualified:false, firstOwnerTestOnly:true,
      rootSealSha256:this.#admission.rootSealSha256, manifestSha256:this.#admission.manifestSha256,
      publicReleaseReady:false, stockFirstInstallSupported:false,
      physicalTransportAuthenticatedByThisReceipt:false, resetEdgeMeasured:false,
      hostFlashBytesDownloaded:false, flashSha256Observed:false});
    const onAbort = () => this.#controller.cancel();
    try {
      const pending = this.#controller.write({explicitWrite:true, currentColdDelTitle:'USB BRIDGE B2'}, options.onProgress);
      // Preserve the external signal API, subject to the controller's precommit cancellation boundary.
      options.signal?.addEventListener('abort', onAbort, {once:true});
      if(options.signal?.aborted) onAbort();
      const transfer = await pending;
      this.#receipt = Object.freeze({...transfer, ...base, status:'storage-readback-verified-reboot-pending'});
      this.#phase = 'reboot-pending';
      return this.#receipt;
    } catch(error) {
      this.#receipt = Object.freeze({...this.#controller.receipt, ...base, status:'failed-preserve-device-state', automaticRetryAllowed:false});
      this.#phase = 'terminal';
      throw error;
    } finally {options.signal?.removeEventListener('abort', onAbort);}
  }

  reportNormalBoot(owner: OwnerNormal) {
    requireValue(this.#phase === 'reboot-pending' && this.#receipt, 'Only this completed storage attempt can receive its next boot report');
    allowOnlyFields(record(owner,'owner report'), new Set(['fullPowerRemoval','title','knownSampleWorks','synthWorks','synthExitWorks','stoppedPatternRecordingWorks','chosenPadSavePlaybackWorks','exactReply']), 'single-take owner report');
    requireValue(owner?.fullPowerRemoval === true && owner.title === this.expectedNormalIdentity && owner.knownSampleWorks === true &&
      owner.synthWorks === true && owner.stoppedPatternRecordingWorks === true && owner.chosenPadSavePlaybackWorks === true && owner.synthExitWorks === true &&
      typeof owner.exactReply === 'string' && owner.exactReply.trim().length > 0 && owner.exactReply.length <= 4096,
      `Full-power ${this.expectedNormalIdentity} title, sample, Synth, one stopped-pattern recording, pad save/playback and EXIT reports are required`);
    this.#receipt = Object.freeze({...this.#receipt, status:'normal-owner-reported-cold-del-pending', normalBootConfirmed:true,
      normalBoot:Object.freeze({...owner, reportedAt:now(), evidenceKind:'owner-reported', resetEdgeMeasured:false})});
    this.#phase = 'normal-owner-reported';
    return this.#receipt;
  }

  async confirmColdDel(owner: OwnerDel, options: ConnectOptions = {}) {
    requireValue(this.#phase === 'normal-owner-reported' && this.#receipt, 'Report this attempt\'s normal boot before the fresh cold-DEL check');
    requireValue(owner?.fullPowerRemoval === true && owner.title === 'USB BRIDGE B2' && typeof owner.exactReply === 'string' && owner.exactReply.trim().length > 0 && owner.exactReply.length <= 4096, 'A fresh full-power DEL/B2 owner report is required');
    this.#phase = 'cold-del-checking';
    try {
      const probe = await probeB2WriterReadOnly(options);
      this.#receipt = Object.freeze({...this.#receipt, status:'completed-owner-and-browser-post-reboot-checks', coldDelConfirmed:true,
        coldDel:Object.freeze({owner:Object.freeze({...owner, reportedAt:now(), evidenceKind:'owner-reported'}), probe,
          statusEvidenceKind:'browser-returned-fresh-idle-profile', separateConnectionFromStorage:true})});
      this.#phase = 'completed-owner-and-browser-checks';
      return this.#receipt;
    } catch(error) {
      this.#receipt = Object.freeze({...this.#receipt, coldDelCheckFailure:Object.freeze({at:now(), message:error instanceof Error ? error.message : 'Cold DEL check failed'}), coldDelConfirmed:false});
      this.#phase = 'terminal';
      throw error;
    }
  }

  async downloadableReceipt(): Promise<{readonly bytes:Uint8Array; readonly sha256:string; readonly filename:string}> {
    requireValue(this.#receipt, 'No attempt receipt is available');
    const bytes = new TextEncoder().encode(JSON.stringify(this.#receipt, null, 2) + '\n');
    return Object.freeze({bytes, sha256:await hexDigest(bytes), filename:`synth-usb-${this.#receipt!.attemptId ?? this.#receipt!.startedAt}.json`});
  }
}
