import {connectB2Writer, preflightB2Writer, writeB2Image, probeB2WriterReadOnly, B2DeliveryError} from './b2-driver.ts';
import type {B2WriterSession} from './b2-driver.ts';
import type {ConnectOptions, OperationOptions} from './model.ts';
import type {QualifiedP6SRestoration} from './release.ts';
import {resolveQualifiedImage} from './release.ts';
import {hexDigest} from './data.ts';

type Phase = 'ready'|'connecting'|'profile-confirmed'|'writing'|'reboot-pending'|'normal-owner-reported'|'cold-del-checking'|'completed-owner-and-browser-checks'|'terminal';
type OwnerNormal = {readonly fullPowerRemoval: true; readonly title: 'SYNTH P6S!'; readonly knownSampleWorks: true; readonly synthWorks: true; readonly exitReentryCycles: number; readonly exactReply: string};
type OwnerDel = {readonly fullPowerRemoval: true; readonly title: 'USB BRIDGE B2'; readonly exactReply: string};
const requireValue = (value: unknown, message: string): void => {if(!value)throw new TypeError(message);};
const now = () => new Date().toISOString();

/** Owner-local UI integration. Calls that open a picker must run directly from a user action. */
export class SynthUsbReleaseFlow {
  #admission: QualifiedP6SRestoration;
  #session?: B2WriterSession;
  #phase: Phase = 'ready';
  #receipt?: Readonly<Record<string, unknown>>;
  #progress: Readonly<Record<string, unknown>>[] = [];
  constructor(admission: QualifiedP6SRestoration) {
    resolveQualifiedImage(admission,'restoration');
    this.#admission = admission;
  }
  get phase(): Phase {return this.#phase;}
  get receipt(): Readonly<Record<string, unknown>>|undefined {return this.#receipt;}

  async connect(options: ConnectOptions = {}) {
    requireValue(this.#phase === 'ready','Start a fresh flow before requesting another connection');
    this.#phase = 'connecting';
    try {
      this.#session = await connectB2Writer(options);
      const profile = await preflightB2Writer(this.#session,this.#admission,'restoration');
      this.#phase = 'profile-confirmed';
      return profile;
    } catch(error) {this.#phase='terminal'; await this.#close(); throw error;}
  }

  async write(confirmation: {readonly unchangedP6S: true; readonly currentColdDelTitle: 'USB BRIDGE B2'}, options: OperationOptions = {}) {
    requireValue(this.#phase === 'profile-confirmed' && this.#session,'Connect and confirm the B2 profile first');
    requireValue(confirmation?.unchangedP6S === true && confirmation.currentColdDelTitle === 'USB BRIDGE B2','Explicit unchanged-P6S write and current DEL title confirmation are required');
    this.#phase = 'writing';
    const startedAt = now();
    const attemptId = globalThis.crypto.randomUUID();
    const base = Object.freeze({schema:'opensp-synth-usb-delivery-attempt-v1',version:1,attemptId,startedAt,
      scope:this.#admission.scope,image:this.#admission.restoration,authenticatedEvidence:this.#admission.authenticatedEvidence,
      candidateUploadEnabled:false,publicReleaseReady:false,stockFirstInstallSupported:false,
      physicalTransportAuthenticatedByThisReceipt:false,resetEdgeMeasured:false,hostFlashBytesDownloaded:false,flashSha256Observed:false,
    });
    try {
      // A profile button may precede Write by minutes; the write owns a new, bounded preflight.
      const fresh = await preflightB2Writer(this.#session!,this.#admission,'restoration',{signal:options.signal});
      const storage = await writeB2Image(this.#session!,this.#admission,'restoration',fresh,{
        signal:options.signal,onProgress:progress => {
          this.#progress.push(Object.freeze({...progress,at:now()}));
          options.onProgress?.(progress);
        },
      });
      this.#receipt = Object.freeze({...base,completedAt:now(),status:'storage-readback-verified-reboot-pending',
        storage,progress:Object.freeze([...this.#progress]),normalBootConfirmed:false,coldDelConfirmed:false,
      });
      this.#phase = 'reboot-pending';
      return this.#receipt;
    } catch(error) {
      const failure = error instanceof B2DeliveryError ? {stage:error.stage,commitMayHaveBeenAccepted:error.commitMayHaveBeenAccepted,
        deviceReadbackReported:error.deviceReadbackReported,separateStatusVerified:error.separateStatusVerified} :
        {stage:'preflight',commitMayHaveBeenAccepted:false,deviceReadbackReported:false,separateStatusVerified:false};
      this.#receipt = Object.freeze({...base,completedAt:now(),status:'failed-preserve-device-state',failure:Object.freeze({...failure,
        message:error instanceof Error?error.message:'USB update failed'}),progress:Object.freeze([...this.#progress]),
        normalBootConfirmed:false,coldDelConfirmed:false,automaticRetryAllowed:false,
      });
      this.#phase='terminal'; throw error;
    } finally {await this.#close();}
  }

  reportNormalBoot(owner: OwnerNormal) {
    requireValue(this.#phase === 'reboot-pending' && this.#receipt,'Only this completed storage attempt can receive its next boot report');
    requireValue(owner?.fullPowerRemoval === true && owner.title === 'SYNTH P6S!' && owner.knownSampleWorks === true &&
      owner.synthWorks === true && Number.isSafeInteger(owner.exitReentryCycles) && owner.exitReentryCycles >= 2 &&
      typeof owner.exactReply === 'string' && owner.exactReply.length > 0 && owner.exactReply.length <= 4096,'Full-power normal P6S title, sample, Synth and two EXIT/reentry reports are required');
    this.#receipt = Object.freeze({...this.#receipt,status:'normal-owner-reported-cold-del-pending',normalBootConfirmed:true,
      normalBoot:Object.freeze({...owner,reportedAt:now(),evidenceKind:'owner-reported',resetEdgeMeasured:false}),
    });
    this.#phase='normal-owner-reported';
    return this.#receipt;
  }

  async confirmColdDel(owner: OwnerDel, options: ConnectOptions = {}) {
    requireValue(this.#phase === 'normal-owner-reported' && this.#receipt,'Report this attempt\'s normal boot before the fresh cold-DEL check');
    requireValue(owner?.fullPowerRemoval === true && owner.title === 'USB BRIDGE B2' && typeof owner.exactReply === 'string' &&
      owner.exactReply.length > 0 && owner.exactReply.length <= 4096,'A fresh full-power DEL/B2 owner report is required');
    this.#phase='cold-del-checking';
    try {
      // Always a new picker and handle after the prior writer was closed; no imported old probe.
      const probe = await probeB2WriterReadOnly(options);
      this.#receipt = Object.freeze({...this.#receipt,status:'completed-owner-and-browser-post-reboot-checks',coldDelConfirmed:true,
        coldDel:Object.freeze({owner:Object.freeze({...owner,reportedAt:now(),evidenceKind:'owner-reported'}),probe,
          statusEvidenceKind:'browser-returned-fresh-idle-profile',separateConnectionFromStorage:true}),
      });
      this.#phase='completed-owner-and-browser-checks';
      return this.#receipt;
    } catch(error) {
      this.#receipt = Object.freeze({...this.#receipt,coldDelCheckFailure:Object.freeze({at:now(),message:error instanceof Error?error.message:'Cold DEL check failed'}),coldDelConfirmed:false});
      this.#phase='terminal';throw error;
    }
  }

  async downloadableReceipt(): Promise<{readonly bytes:Uint8Array; readonly sha256:string; readonly filename:string}> {
    requireValue(this.#receipt,'No write receipt is available');
    const bytes = new TextEncoder().encode(JSON.stringify(this.#receipt,null,2)+'\n');
    return Object.freeze({bytes,sha256:await hexDigest(bytes),filename:`synth-usb-${this.#receipt!.attemptId}.json`});
  }

  async #close() {if(this.#session){try{await this.#session.close();}catch{/* Preserve the original receipt or failure. */}this.#session=undefined;}}
}
