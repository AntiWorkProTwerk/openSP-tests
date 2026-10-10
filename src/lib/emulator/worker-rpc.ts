import type {VirtualUpdateBridge, VirtualUpdateSnapshot} from './update.ts';
import type {App1ResetContract} from './image.ts';
import {ownSdFixtures, describeSdFixture, safeSdStatus, type VirtualSdFixtures, type VirtualSdStatus} from './sd-fixtures.ts';

/** One bridge owns one production browser worker; sharing its ID space is unsupported. */
export type EmulatorWorkerPort = Pick<Worker, 'postMessage' | 'addEventListener' | 'removeEventListener' | 'terminate'>;
export interface EmulatorWorkerSnapshot extends VirtualUpdateSnapshot {
  state: 'loaded' | 'paused' | 'running' | 'halted' | 'fault' | 'closed';
  pc: number;
  instructions: number;
  firmwareHash: string;
  heartbeat?: number;
  mailboxCached?: boolean;
  display?: number[];
  displayOn?: boolean;
  marker?: number;
  frames?: number;
  fault?: string;
  limitations?: string[];
  unknownMmio?: {address: number; width: number; operation: string; count: number}[];
  unknownMmioOverflow?: number;
  checkpoint?: unknown;
  sd1?: VirtualSdStatus;
  sd2?: VirtualSdStatus;
  [field: string]: unknown;
}
export type EmulatorWorkerObservation =
  | {type: 'request'; id: number; command: string; details: Record<string, unknown>}
  | {type: 'snapshot'; id: number; snapshot: EmulatorWorkerSnapshot}
  | {type: 'terminal'; error: EmulatorWorkerRpcError};
export interface EmulatorWorkerCallOptions {signal?: AbortSignal; timeoutMs?: number}
export interface EmulatorWorkerBridgeOptions {
  requestTimeoutMs?: number;
  loadTimeoutMs?: number;
  bootTimeoutMs?: number;
  bootInstructions?: number;
  bootSliceInstructions?: number;
}
export type EmulatorWorkerRpcCode = 'invalid-argument' | 'closed' | 'timeout' | 'cancelled' |
  'worker-error' | 'message-error' | 'post-message' | 'protocol-error' | 'remote-error' |
  'reset-busy' | 'reset-contract' | 'boot-budget' | 'boot-timeout' | 'boot-no-progress' |
  'engine-failed' | 'guest-stopped';

export class EmulatorWorkerRpcError extends Error {
  readonly code: EmulatorWorkerRpcCode;
  readonly command: string;
  readonly evidence: unknown;
  constructor(code: EmulatorWorkerRpcCode, command: string, message: string, evidence?: unknown) {
    super(message); this.name = 'EmulatorWorkerRpcError';
    this.code = code; this.command = command; this.evidence = evidence;
  }
}

type Reply = {id: number; type: string; message?: string; report?: unknown; trace?: unknown; [field: string]: unknown};
type Result = {reply: Reply; snapshot?: EmulatorWorkerSnapshot};
type Pending = {
  command: string;
  primary: 'loaded' | 'usb' | 'status' | 'trace';
  needsStatus: boolean;
  reply?: Reply;
  resolve: (result: Result) => void;
  reject: (error: EmulatorWorkerRpcError) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
};
const states = new Set(['loaded', 'paused', 'running', 'halted', 'fault', 'closed']);
const positiveBound = (value: number, maximum: number) => Number.isSafeInteger(value) && value > 0 && value <= maximum;
const uint32 = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const counter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const clone = <T>(value: T): T => structuredClone(value);

/** No physical transport is opened. USB payloads and boot evidence come from the worker. */
export class EmulatorWorkerBridge implements VirtualUpdateBridge {
  private readonly worker: EmulatorWorkerPort;
  private readonly options: Required<EmulatorWorkerBridgeOptions>;
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private snapshotId = 0;
  private latest?: EmulatorWorkerSnapshot;
  private terminal?: EmulatorWorkerRpcError;
  private resetting = false;
  private runningIntent = false;
  private intentGeneration = 0;
  private ignored = 0;
  private readonly observers = new Set<(event: EmulatorWorkerObservation) => void>();
  private readonly messageListener: EventListener;
  private readonly errorListener: EventListener;
  private readonly messageErrorListener: EventListener;

  constructor(worker: EmulatorWorkerPort, options: EmulatorWorkerBridgeOptions = {}) {
    if (!worker || ['postMessage', 'addEventListener', 'removeEventListener', 'terminate']
      .some(name => typeof (worker as unknown as Record<string, unknown>)[name] !== 'function')) {
      throw new EmulatorWorkerRpcError('invalid-argument', 'setup', 'A separately owned browser Worker port is required.');
    }
    this.worker = worker;
    this.options = {requestTimeoutMs: options.requestTimeoutMs ?? 30000,
      loadTimeoutMs: options.loadTimeoutMs ?? 45000, bootTimeoutMs: options.bootTimeoutMs ?? 30000,
      bootInstructions: options.bootInstructions ?? 4000000, bootSliceInstructions: options.bootSliceInstructions ?? 25000};
    for (const [name, value] of Object.entries(this.options)) {
      const maximum = name === 'bootInstructions' ? 100000000 : name === 'bootSliceInstructions' ? 1000000 : 300000;
      if (!positiveBound(value, maximum)) throw new EmulatorWorkerRpcError('invalid-argument', 'setup', `${name} must be a positive integer no greater than ${maximum}.`);
    }
    this.messageListener = event => this.receive((event as MessageEvent).data);
    this.errorListener = event => {
      event.preventDefault();
      this.shutdown(new EmulatorWorkerRpcError('worker-error', 'worker',
        `The emulator worker failed: ${(event as ErrorEvent).message || 'an error event was received'}.`, this.latestDiagnostics));
    };
    this.messageErrorListener = () => this.shutdown(new EmulatorWorkerRpcError('message-error', 'worker',
      'The emulator worker message could not be decoded.', this.latestDiagnostics));
    worker.addEventListener('message', this.messageListener);
    worker.addEventListener('error', this.errorListener);
    worker.addEventListener('messageerror', this.messageErrorListener);
  }

  get closed(): boolean {return this.terminal !== undefined;}
  get closedError(): EmulatorWorkerRpcError | undefined {return this.terminal;}
  /** Cached observation only. snapshot() asks the guest for a new reply. */
  get latestDiagnostics(): EmulatorWorkerSnapshot | undefined {return this.latest && clone(this.latest);}
  get ignoredResponses(): number {return this.ignored;}

  /** Observations never settle calls. Each subscriber receives its own copy. */
  subscribe(observer: (event: EmulatorWorkerObservation) => void): () => void {
    this.observers.add(observer);
    return () => {this.observers.delete(observer);};
  }
  private observe(event: EmulatorWorkerObservation) {
    for (const observer of this.observers) {
      let copy: EmulatorWorkerObservation;
      try {copy = event.type === 'terminal'
        ? {type: 'terminal', error: new EmulatorWorkerRpcError(event.error.code, event.error.command,
          event.error.message, clone(event.error.evidence))} : clone(event);} catch {continue;}
      queueMicrotask(() => {
        if (!this.observers.has(observer) || this.closed && event.type !== 'terminal') return;
        try {observer(copy);} catch { /* An observer cannot interrupt the transport. */ }
      });
    }
  }

  private available(command: string) {
    if (this.terminal) throw new EmulatorWorkerRpcError('closed', command, 'This emulator worker bridge is closed.', this.terminal);
    if (this.resetting) throw new EmulatorWorkerRpcError('reset-busy', command, 'The retained-NOR reset and bounded boot are still active.');
  }
  private callTimeout(command: string, options: EmulatorWorkerCallOptions, fallback = this.options.requestTimeoutMs): number {
    const timeout = options.timeoutMs ?? fallback;
    if (!positiveBound(timeout, 300000)) throw new EmulatorWorkerRpcError('invalid-argument', command, 'Request timeout must be 1..300,000 milliseconds.');
    if (options.signal?.aborted) throw new EmulatorWorkerRpcError('cancelled', command, 'This request was cancelled before it was sent.');
    return timeout;
  }

  async load(image: Uint8Array | ArrayBuffer, options: {format: 'app1' | 'flash'; name?: string} & EmulatorWorkerCallOptions & VirtualSdFixtures) {
    this.available('load');
    if (this.pending.size) throw new EmulatorWorkerRpcError('reset-busy', 'load', 'Finish outstanding requests before replacing the firmware image.');
    if (!(image instanceof Uint8Array || image instanceof ArrayBuffer) || !image.byteLength || image.byteLength > 4 * 1024 * 1024 ||
      (options?.format !== 'app1' && options?.format !== 'flash')) {
      throw new EmulatorWorkerRpcError('invalid-argument', 'load', 'Load requires a non-empty local image up to 4 MiB and an APP1 or full-flash format.');
    }
    this.callTimeout('load', options, this.options.loadTimeoutMs);
    let cards;
    try {cards = ownSdFixtures(options);} catch (error) {
      throw new EmulatorWorkerRpcError('invalid-argument', 'load', error instanceof Error ? error.message : String(error));
    }
    ++this.intentGeneration; this.runningIntent = false;
    const bytes = new Uint8Array(image).slice().buffer;
    const sd1 = cards.sd1?.buffer, sd2 = cards.sd2?.buffer;
    const transfers = [bytes, ...[sd1, sd2].filter((card): card is ArrayBuffer => card !== undefined)];
    const result = await this.request('load', {image: bytes, format: options.format, name: options.name, sd1, sd2}, 'loaded', true,
      {signal: options.signal, timeoutMs: options.timeoutMs ?? this.options.loadTimeoutMs}, transfers);
    return result.snapshot!;
  }

  async transport(report?: number[], options: EmulatorWorkerCallOptions = {}): Promise<number[]> {
    this.available('usb');
    if (report !== undefined && (!Array.isArray(report) || report.length !== 64 || report.some(value => !uint32(value) || value > 255))) {
      throw new EmulatorWorkerRpcError('invalid-argument', 'usb', 'Virtual USB feature reports contain exactly 64 bytes without a report-ID prefix.');
    }
    const result = await this.request('usb', {report: report && [...report]}, 'usb', true, options);
    return [...result.reply.report as number[]];
  }
  async snapshot(options: EmulatorWorkerCallOptions = {}): Promise<EmulatorWorkerSnapshot> {
    this.available('status'); return (await this.request('status', {}, 'status', false, options)).snapshot!;
  }
  async step(instructions = 25000, options: EmulatorWorkerCallOptions = {}) {
    this.available('step');
    if (!positiveBound(instructions, 1000000)) throw new EmulatorWorkerRpcError('invalid-argument', 'step', 'Step requires 1..1,000,000 instructions.');
    return this.control('step', {instructions}, false, options);
  }
  async input(input: Record<string, unknown>, options: EmulatorWorkerCallOptions = {}) {
    this.available('input');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new EmulatorWorkerRpcError('invalid-argument', 'input', 'An input object is required.');
    return (await this.request('input', {input: clone(input)}, 'status', false, options)).snapshot!;
  }
  async run(options: EmulatorWorkerCallOptions = {}) {
    this.available('run'); return this.control('run', {}, true, options);
  }
  async pause(options: EmulatorWorkerCallOptions = {}) {
    this.available('pause'); return this.control('pause', {}, false, options);
  }
  private async control(command: string, details: object, intent: boolean, options: EmulatorWorkerCallOptions) {
    this.callTimeout(command, options);
    const generation = ++this.intentGeneration, previous = this.runningIntent;
    this.runningIntent = intent;
    try {
      const snapshot = (await this.request(command, details, 'status', false, options)).snapshot!;
      if (generation === this.intentGeneration) this.runningIntent = intent && snapshot.state === 'running';
      return snapshot;
    } catch (error) {if (!this.closed && generation === this.intentGeneration) this.runningIntent = previous; throw error;}
  }
  async trace(options: EmulatorWorkerCallOptions = {}): Promise<unknown> {
    this.available('trace'); return clone((await this.request('trace', {}, 'trace', false, options)).reply.trace);
  }

  /** Generic page reset: acknowledge CPU recreation without requiring a firmware mailbox or boot steps. */
  async restart(options: EmulatorWorkerCallOptions = {}): Promise<EmulatorWorkerSnapshot> {
    this.available('reset');
    this.callTimeout('reset', options);
    this.resetting = true; ++this.intentGeneration; this.runningIntent = false;
    try {
      const snapshot = (await this.request('reset', {}, 'status', false, options)).snapshot!;
      if (snapshot.state !== 'loaded' || snapshot.instructions !== 0) {
        throw new EmulatorWorkerRpcError('reset-contract', 'reset', 'Reset did not acknowledge a fresh loaded CPU with zero instructions.', snapshot);
      }
      return snapshot;
    } finally {this.resetting = false;}
  }

  /** The worker reset recreates CPU/RAM with retained NOR; fresh mailbox proof then executes guest code. */
  async reset(options?: EmulatorWorkerCallOptions): Promise<void>;
  async reset(target?: App1ResetContract, options?: EmulatorWorkerCallOptions): Promise<void>;
  async reset(targetOrOptions?: App1ResetContract | EmulatorWorkerCallOptions, callOptions?: EmulatorWorkerCallOptions): Promise<void> {
    this.available('reset');
    if (this.pending.size) throw new EmulatorWorkerRpcError('reset-busy', 'reset', 'Finish outstanding requests before the retained-NOR reset.');
    if (targetOrOptions !== undefined && (!targetOrOptions || typeof targetOrOptions !== 'object' || Array.isArray(targetOrOptions))) {
      throw new EmulatorWorkerRpcError('invalid-argument', 'reset', 'Reset requires call options or an explicit APP1 extent and hash contract.');
    }
    const targetKeys = ['length', 'sha256', 'expectedCurrentSha256', 'selector'];
    const isTarget = targetOrOptions !== undefined && (callOptions !== undefined || targetKeys.some(key => Object.hasOwn(targetOrOptions, key)));
    const options = ((isTarget || targetOrOptions === undefined ? callOptions : targetOrOptions) as EmulatorWorkerCallOptions | undefined) ?? {};
    if (!isTarget && targetOrOptions !== undefined && Object.keys(targetOrOptions).some(key => !['signal', 'timeoutMs'].includes(key))) {
      throw new EmulatorWorkerRpcError('invalid-argument', 'reset', 'Reset call options contain unsupported fields.');
    }
    let target: App1ResetContract | undefined;
    if (isTarget) {
      const contract = targetOrOptions as App1ResetContract;
      const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
      if (Object.keys(contract).some(key => !targetKeys.includes(key)) || !positiveBound(contract.length, 0x37f000) || contract.length < 4 ||
        !hash(contract.sha256) || !hash(contract.expectedCurrentSha256) || contract.selector !== undefined && contract.selector !== 'b1-del-writer') {
        throw new EmulatorWorkerRpcError('invalid-argument', 'reset', 'APP1 reset requires 4..0x37F000 bytes, complete target/current SHA256 hashes and a supported selector.');
      }
      target = clone(contract);
    }
    this.callTimeout('reset', options);
    this.resetting = true; ++this.intentGeneration; this.runningIntent = false;
    const timer = setTimeout(() => this.shutdown(new EmulatorWorkerRpcError('boot-timeout', 'reset',
      'The reset and fresh-mailbox boot exceeded the configured wall-clock bound.', this.latestDiagnostics)), this.options.bootTimeoutMs);
    try {
      const entry = (await this.request('reset', target ? {target} : {}, 'status', false, options)).snapshot!;
      if (entry.state !== 'loaded' || entry.instructions !== 0 || entry.firmwareState !== undefined || entry.heartbeat !== undefined ||
        entry.cpuBackendFailed !== false || entry.mailboxCached !== false) {
        throw new EmulatorWorkerRpcError('reset-contract', 'reset', 'Reset did not acknowledge a fresh CPU without a recognized live firmware mailbox.', entry);
      }
      let previous = 0;
      for (let budget = 0; budget < this.options.bootInstructions;) {
        const count = Math.min(this.options.bootSliceInstructions, this.options.bootInstructions - budget);
        const snapshot = (await this.request('step', {instructions: count}, 'status', false, options)).snapshot!;
        budget += count;
        if (snapshot.cpuBackendFailed || snapshot.mailboxCached) {
          throw new EmulatorWorkerRpcError('engine-failed', 'reset', 'The emulator engine failed before an uncached fresh mailbox was observed.', snapshot);
        }
        if (snapshot.fault || snapshot.state === 'fault' || snapshot.state === 'halted' || snapshot.state === 'closed') {
          throw new EmulatorWorkerRpcError('guest-stopped', 'reset', 'Guest execution stopped before fresh mailbox verification.', snapshot);
        }
        if (snapshot.instructions <= previous || snapshot.instructions > budget) {
          throw new EmulatorWorkerRpcError('boot-no-progress', 'reset', 'The bounded boot did not report valid forward instruction progress.', snapshot);
        }
        previous = snapshot.instructions;
        if (snapshot.state === 'paused' && snapshot.firmwareState === 2 && uint32(snapshot.marker) && uint32(snapshot.heartbeat) &&
          snapshot.cpuBackendFailed === false && snapshot.mailboxCached === false) return;
      }
      throw new EmulatorWorkerRpcError('boot-budget', 'reset', 'The guest did not publish a recognized fresh running mailbox within the instruction budget.', this.latestDiagnostics);
    } finally {clearTimeout(timer); this.resetting = false;}
  }

  /** Bind the same AbortSignal here and in updater.update() to cancel the owned transport too. */
  asUpdateBridge(options: EmulatorWorkerCallOptions = {}): VirtualUpdateBridge {
    return {transport: request => this.transport(request, options), reset: target => this.reset(target, options), snapshot: () => this.snapshot(options)};
  }
  close(reason = 'The emulator worker bridge was closed.') {
    this.shutdown(new EmulatorWorkerRpcError('closed', 'close', reason, this.latestDiagnostics));
  }

  private request(command: string, details: object, primary: Pending['primary'], needsStatus: boolean,
    options: EmulatorWorkerCallOptions, transfer: Transferable[] = []): Promise<Result> {
    if (this.terminal) return Promise.reject(new EmulatorWorkerRpcError('closed', command, 'This emulator worker bridge is closed.', this.terminal));
    const timeout = this.callTimeout(command, options);
    if (this.sequence === Number.MAX_SAFE_INTEGER) {
      const error = new EmulatorWorkerRpcError('protocol-error', command, 'The worker request-ID space is exhausted.'); this.shutdown(error); return Promise.reject(error);
    }
    const id = ++this.sequence;
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => this.shutdown(new EmulatorWorkerRpcError('timeout', command,
        `The emulator worker did not complete ${command} within ${timeout} ms.`, this.latestDiagnostics)), timeout);
      const abort = () => this.shutdown(new EmulatorWorkerRpcError('cancelled', command,
        'An in-flight request was cancelled. The owned worker was terminated; no retry or rollback is implied.', this.latestDiagnostics));
      const pending: Pending = {command, primary, needsStatus, resolve, reject, timer, signal: options.signal, abort};
      this.pending.set(id, pending); options.signal?.addEventListener('abort', abort, {once: true});
      const {image: _image, sd1, sd2, ...observedDetails} = details as Record<string, unknown>;
      if (command === 'load') {
        observedDetails.sd1 = describeSdFixture(sd1 as ArrayBuffer | undefined);
        observedDetails.sd2 = describeSdFixture(sd2 as ArrayBuffer | undefined);
      }
      this.observe({type: 'request', id, command, details: observedDetails});
      try {this.worker.postMessage({id, command, ...details}, transfer);}
      catch (error) {this.shutdown(new EmulatorWorkerRpcError('post-message', command,
        `The emulator worker request could not be sent: ${error instanceof Error ? error.message : String(error)}.`, this.latestDiagnostics));}
    });
  }

  private status(reply: Reply): EmulatorWorkerSnapshot {
    const {id: _id, type: _type, ...snapshot} = reply;
    if (typeof snapshot.state !== 'string' || !states.has(snapshot.state) || !uint32(snapshot.pc) ||
      typeof snapshot.instructions !== 'number' || !Number.isSafeInteger(snapshot.instructions) || snapshot.instructions < 0 ||
      typeof snapshot.firmwareHash !== 'string' || !/^[a-f0-9]{64}$/i.test(snapshot.firmwareHash)) {
      throw new EmulatorWorkerRpcError('protocol-error', 'status', 'The worker status is missing valid state, PC, instruction count or image hash.', reply);
    }
    if (snapshot.display !== undefined && (!Array.isArray(snapshot.display) || snapshot.display.length !== 1024 ||
        snapshot.display.some(value => !uint32(value) || value > 255)) ||
      snapshot.displayOn !== undefined && typeof snapshot.displayOn !== 'boolean' ||
      snapshot.limitations !== undefined && (!Array.isArray(snapshot.limitations) || snapshot.limitations.some(value => typeof value !== 'string')) ||
      snapshot.fault !== undefined && typeof snapshot.fault !== 'string' ||
      snapshot.marker !== undefined && !uint32(snapshot.marker) ||
      snapshot.frames !== undefined && !counter(snapshot.frames) ||
      snapshot.unknownMmioOverflow !== undefined && !counter(snapshot.unknownMmioOverflow) ||
      snapshot.unknownMmio !== undefined && (!Array.isArray(snapshot.unknownMmio) || snapshot.unknownMmio.some(row =>
        !row || typeof row !== 'object' || !uint32(row.address) || !uint32(row.width) || !counter(row.count) || typeof row.operation !== 'string'))) {
      throw new EmulatorWorkerRpcError('protocol-error', 'status', 'The worker status contains invalid display or diagnostic fields.', reply);
    }
    return clone(snapshot) as EmulatorWorkerSnapshot;
  }
  private remember(id: number, snapshot: EmulatorWorkerSnapshot) {
    if (id > 0 && id < this.snapshotId) return;
    if (id === 0 && (!this.runningIntent || this.resetting || !this.latest || snapshot.firmwareHash !== this.latest.firmwareHash ||
      snapshot.instructions < this.latest.instructions)) {this.ignored++; return;}
    if (id > 0) this.snapshotId = id;
    this.latest = clone(snapshot);
    this.observe({type: 'snapshot', id, snapshot});
  }
  private finish(id: number, result?: Result, error?: EmulatorWorkerRpcError) {
    const pending = this.pending.get(id); if (!pending) return;
    this.pending.delete(id); clearTimeout(pending.timer);
    if (pending.abort) pending.signal?.removeEventListener('abort', pending.abort);
    if (error) pending.reject(error); else pending.resolve(result!);
  }
  private receive(raw: unknown) {
    if (this.terminal) return;
    if (!raw || typeof raw !== 'object') {this.ignored++; return;}
    let reply = raw as Reply;
    if (!Number.isSafeInteger(reply.id) || reply.id < 0 || typeof reply.type !== 'string') {this.ignored++; return;}
    const pending = this.pending.get(reply.id);
    if (reply.id > 0 && !pending) {this.ignored++; return;}
    try {
      const {sd1, sd2, ...rest} = reply;
      reply = rest as Reply;
      if (sd1 !== undefined) reply.sd1 = safeSdStatus(sd1);
      if (sd2 !== undefined) reply.sd2 = safeSdStatus(sd2);
      if (reply.type === 'trace' && reply.trace && typeof reply.trace === 'object' && !ArrayBuffer.isView(reply.trace)) {
        const {sd1: traceSd1, sd2: traceSd2, ...trace} = reply.trace as Record<string, unknown>;
        if (traceSd1 !== undefined) trace.sd1 = safeSdStatus(traceSd1);
        if (traceSd2 !== undefined) trace.sd2 = safeSdStatus(traceSd2);
        reply.trace = trace;
      }
    } catch {
      this.shutdown(new EmulatorWorkerRpcError('protocol-error', pending?.command ?? 'status',
        'The worker reply contains invalid SD metadata.', this.latestDiagnostics)); return;
    }
    if (reply.id === 0) {
      if (reply.type === 'error') this.shutdown(new EmulatorWorkerRpcError('remote-error', 'run',
        `The worker reported an asynchronous execution error: ${reply.message || 'no diagnostic text'}.`, this.latestDiagnostics));
      else if (reply.type === 'status') {
        try {this.remember(0, this.status(reply));}
        catch (error) {this.shutdown(error instanceof EmulatorWorkerRpcError ? error : new EmulatorWorkerRpcError('protocol-error', 'status', String(error)));}
      } else this.ignored++;
      return;
    }
    // Retired, unknown and late IDs cannot resolve calls or replace diagnostics.
    if (!pending) {this.ignored++; return;}
    if (reply.type === 'error') {
      this.finish(reply.id, undefined, new EmulatorWorkerRpcError('remote-error', pending.command,
        reply.message || 'The emulator worker rejected this request.', this.latestDiagnostics)); return;
    }
    try {
      if (pending.reply) {
        if (reply.type !== 'status') throw new EmulatorWorkerRpcError('protocol-error', pending.command, 'The primary reply was duplicated or its status acknowledgment has the wrong type.', reply);
        const snapshot = this.status(reply); this.remember(reply.id, snapshot);
        this.finish(reply.id, {reply: pending.reply, snapshot}); return;
      }
      if (reply.type !== pending.primary) throw new EmulatorWorkerRpcError('protocol-error', pending.command, `Expected ${pending.primary}, received ${reply.type}.`, reply);
      if (reply.type === 'usb' && (!Array.isArray(reply.report) || reply.report.length !== 64 || reply.report.some(value => !uint32(value) || value > 255))) {
        throw new EmulatorWorkerRpcError('protocol-error', 'usb', 'The USB reply is not exactly 64 byte values.', reply);
      }
      if (reply.type === 'trace' && !Object.hasOwn(reply, 'trace')) throw new EmulatorWorkerRpcError('protocol-error', 'trace', 'The trace reply has no trace value.', reply);
      const snapshot = reply.type === 'loaded' || reply.type === 'status' ? this.status(reply) : undefined;
      if (snapshot) this.remember(reply.id, snapshot);
      if (pending.needsStatus) pending.reply = clone(reply);
      else this.finish(reply.id, {reply: clone(reply), snapshot});
    } catch (error) {this.shutdown(error instanceof EmulatorWorkerRpcError ? error : new EmulatorWorkerRpcError('protocol-error', pending.command, String(error)));}
  }
  private shutdown(error: EmulatorWorkerRpcError) {
    if (this.terminal) return;
    this.terminal = error; this.runningIntent = false;
    this.worker.removeEventListener('message', this.messageListener);
    this.worker.removeEventListener('error', this.errorListener);
    this.worker.removeEventListener('messageerror', this.messageErrorListener);
    for (const id of this.pending.keys()) this.finish(id, undefined, error);
    this.worker.terminate();
    this.observe({type: 'terminal', error});
  }
}

/** Starts only when called. Importing this module creates no worker or physical USB handle. */
export function createBrowserWorkerBridge(options: EmulatorWorkerBridgeOptions = {}): EmulatorWorkerBridge {
  if (typeof Worker === 'undefined') throw new EmulatorWorkerRpcError('invalid-argument', 'setup', 'Create a production worker bridge in a browser, or supply a worker port explicitly.');
  const worker = new Worker(new URL('../../scripts/emulator-worker.ts', import.meta.url), {type: 'module'});
  try {return new EmulatorWorkerBridge(worker, options);} catch (error) {worker.terminate(); throw error;}
}
