export interface RunSleep {
  waitingForInterrupt: boolean;
  idleTicks: number;
  idleQuanta: number;
  kind?: 'wfi';
  address?: number;
  resumePc?: number;
  lastIdle?: {reason: string; idleTicks: number; attemptedTicks: number; detail?: string};
}
export interface RunSnapshot {
  state: string;
  instructions: number;
  pc: number;
  firmwareHash: string;
  powered: boolean;
  cpuBackendFailed: boolean;
  mailboxCached: boolean;
  sleep?: RunSleep;
  [field: string]: unknown;
}
export interface RunStep {
  instructions: number;
  totalInstructions: number;
  pc: number;
  reason: 'budget' | 'stopped' | 'fault';
  backendLost?: boolean;
  sleep?: {kind: 'wfi'; address: number; resumePc: number};
}
export interface RunSession {
  readonly cpu: {readonly backendFailed: boolean};
  readonly image: {readonly sha256: string};
  readonly state: string;
  step(instructions: number): RunStep;
  snapshot(): RunSnapshot;
  pause(): void;
}
export interface RunTimers {
  /** Callbacks run after set returns, as with browser setTimeout. */
  set(callback: () => void, delay: number): unknown;
  /** Cancellation is inert, as with native clearTimeout; it invokes no callback. */
  clear(handle: unknown): void;
  now(): number;
}
export interface RunDiagnostics {
  mode: 'stopped' | 'runnable' | 'parked';
  epoch: number;
  zeroInstructionCalls: number;
  idleTicks: number;
  idleQuanta: number;
  stopReason?: string;
}
export interface RunSchedulerOptions {
  session(): RunSession | undefined;
  timers: RunTimers;
  publish(snapshot: RunSnapshot, diagnostics: RunDiagnostics, running: boolean): void;
  error(error: unknown): void;
}
type Owner = {epoch: number; session: RunSession; cpu: RunSession['cpu']; image: RunSession['image']; hash: string};
export type RunActivityTicket = Readonly<Owner & {kind: 'input' | 'usb'}>;
const safeCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const uint32 = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const limits = {instructions: 25000, callbackQuanta: 64, callbackTicks: 64000000,
  zeroInstructionCalls: 32, idleQuanta: 2048, idleTicks: 2048000000, heartbeatMs: 100} as const;

/** Cooperative worker scheduling. All clock work remains inside Session.step. */
export class WorkerRunScheduler {
  private epoch = 0;
  private owner?: Owner;
  private timer?: {handle?: unknown};
  private mode: RunDiagnostics['mode'] = 'stopped';
  private calls = 0;
  private ticks = 0;
  private quanta = 0;
  private stopReason?: string;
  private lastPublication = -Infinity;
  private parked?: {instructions: number; ticks: number; quanta: number; metadata: NonNullable<RunStep['sleep']>};
  private readonly tickets = new WeakSet<object>();
  private readonly options: RunSchedulerOptions;
  constructor(options: RunSchedulerOptions) {this.options = options;}
  get running(): boolean {return this.mode !== 'stopped';}
  diagnostics(): RunDiagnostics {
    return {mode: this.mode, epoch: this.epoch, zeroInstructionCalls: this.calls,
      idleTicks: this.ticks, idleQuanta: this.quanta, ...(this.stopReason ? {stopReason: this.stopReason} : {})};
  }
  private same(owner: Owner): boolean {
    const session = this.options.session();
    return this.epoch === owner.epoch && session === owner.session && session.cpu === owner.cpu &&
      session.image === owner.image && session.image.sha256 === owner.hash;
  }
  private validOwner(owner: Owner): boolean {
    return this.running && this.owner === owner && this.same(owner) && !owner.cpu.backendFailed &&
      (owner.session.state === 'loaded' || owner.session.state === 'paused');
  }
  private healthy(snapshot: RunSnapshot, owner: Owner): boolean {
    return snapshot.firmwareHash === owner.hash && snapshot.cpuBackendFailed === false && snapshot.mailboxCached === false &&
      snapshot.powered === true && (snapshot.state === 'loaded' || snapshot.state === 'paused') &&
      snapshot.state === owner.session.state &&
      safeCount(snapshot.instructions) && uint32(snapshot.pc);
  }
  private read(owner: Owner): RunSnapshot | undefined {
    if (!this.validOwner(owner)) return undefined;
    const snapshot = owner.session.snapshot();
    return this.validOwner(owner) && this.healthy(snapshot, owner) ? snapshot : undefined;
  }
  private abandon(owner: Owner, reason: string): void {
    if (this.owner !== owner) return;
    this.epoch++; this.mode = 'stopped'; this.stopReason = reason; this.owner = undefined;
    this.parked = undefined;
    const timer = this.timer; this.timer = undefined;
    if (timer) this.options.timers.clear(timer.handle);
  }
  start(): boolean {
    const candidate = this.options.session(), epoch = this.epoch + 1;
    this.stop('run');
    const session = this.options.session();
    if (!session || session !== candidate || this.epoch !== epoch || this.running) return false;
    const owner = {epoch: this.epoch, session, cpu: session.cpu, image: session.image, hash: session.image.sha256};
    this.owner = owner; this.mode = 'runnable'; this.stopReason = undefined;
    this.calls = this.ticks = this.quanta = 0;
    try {
      if (!this.read(owner)) {if (this.same(owner)) this.stop('unavailable'); else this.abandon(owner, 'ownership-changed'); return false;}
      this.schedule(owner, 0);
      return this.validOwner(owner);
    } catch (error) {this.fail(owner, error); return false;}
  }
  stop(reason = 'control'): void {
    this.epoch++; this.mode = 'stopped'; this.stopReason = reason; this.owner = undefined;
    this.parked = undefined;
    const timer = this.timer; this.timer = undefined;
    if (timer) this.options.timers.clear(timer.handle);
    this.options.session()?.pause();
  }
  captureInput(): RunActivityTicket | undefined {
    const owner = this.owner;
    if (!owner || !this.validOwner(owner)) return undefined;
    const ticket = Object.freeze({...owner, kind: 'input' as const}); this.tickets.add(ticket); return ticket;
  }
  rearmAfterInput(ticket?: RunActivityTicket): boolean {
    if (!ticket || ticket.kind !== 'input' || !this.tickets.delete(ticket)) return false;
    const owner = this.owner;
    if (!owner || !this.validOwner(owner) || !this.same(ticket)) return false;
    if (this.mode !== 'parked') return true;
    try {if (!this.read(owner)) {this.abandon(owner, 'unavailable'); return false;}}
    catch (error) {this.fail(owner, error); return false;}
    const timer = this.timer; this.timer = undefined;
    if (timer) this.options.timers.clear(timer.handle);
    this.mode = 'runnable'; this.parked = undefined; this.schedule(owner, 0); return this.validOwner(owner);
  }
  suspendForUsb(): RunActivityTicket | undefined {
    const owner = this.owner, resume = owner && this.validOwner(owner);
    const epoch = this.epoch + 1;
    this.stop('usb');
    if (!resume || !owner || this.epoch !== epoch || this.running || this.options.session() !== owner.session ||
      owner.session.cpu !== owner.cpu || owner.session.image !== owner.image || owner.image.sha256 !== owner.hash) return undefined;
    const ticket = Object.freeze({...owner, epoch, kind: 'usb' as const}); this.tickets.add(ticket); return ticket;
  }
  resumeAfterUsb(ticket?: RunActivityTicket): boolean {
    if (!ticket || ticket.kind !== 'usb' || !this.tickets.delete(ticket) || this.running || !this.same(ticket)) return false;
    const owner: Owner = {epoch: this.epoch, session: ticket.session, cpu: ticket.cpu, image: ticket.image, hash: ticket.hash};
    this.owner = owner; this.mode = 'runnable'; this.stopReason = undefined;
    try {
      if (!this.read(owner)) {if (this.same(owner)) this.stop('unavailable'); else this.abandon(owner, 'ownership-changed'); return false;}
      this.schedule(owner, 0); return this.validOwner(owner);
    } catch (error) {this.fail(owner, error); return false;}
  }
  private schedule(owner: Owner, delay: number): void {
    if (this.timer) return;
    if (!this.validOwner(owner)) {this.abandon(owner, 'ownership-changed'); return;}
    const slot: {handle?: unknown} = {}; this.timer = slot;
    slot.handle = this.options.timers.set(() => {
      if (this.timer !== slot) return;
      if (!this.validOwner(owner)) {this.abandon(owner, 'ownership-changed'); return;}
      this.timer = undefined;
      this.turn(owner);
    }, delay);
  }
  private publish(owner: Owner, snapshot: RunSnapshot): boolean {
    if (!this.validOwner(owner)) {this.abandon(owner, 'ownership-changed'); return false;}
    this.options.publish(snapshot, this.diagnostics(), true);
    if (!this.validOwner(owner)) {this.abandon(owner, 'ownership-changed'); return false;}
    const now = this.options.timers.now();
    if (!this.validOwner(owner)) {this.abandon(owner, 'ownership-changed'); return false;}
    this.lastPublication = now;
    return this.validOwner(owner);
  }
  private finish(owner: Owner, snapshot: RunSnapshot, reason: string): void {
    if (!this.same(owner)) {this.abandon(owner, 'ownership-changed'); return;}
    const epoch = this.epoch + 1;
    this.stop(reason);
    if (this.options.session() === owner.session && owner.session.cpu === owner.cpu && owner.session.image === owner.image &&
      owner.image.sha256 === owner.hash && this.epoch === epoch) {
      this.options.publish(snapshot, this.diagnostics(), false);
      if (this.epoch !== epoch || this.options.session() !== owner.session || owner.session.cpu !== owner.cpu ||
        owner.session.image !== owner.image || owner.image.sha256 !== owner.hash) return;
      const now = this.options.timers.now();
      if (this.epoch === epoch && this.options.session() === owner.session && owner.session.cpu === owner.cpu &&
        owner.session.image === owner.image && owner.image.sha256 === owner.hash) this.lastPublication = now;
    }
  }
  private fail(owner: Owner, error: unknown): void {
    if (!this.same(owner)) {this.abandon(owner, 'ownership-changed'); return;}
    const epoch = this.epoch + 1;
    this.stop('callback-error');
    if (this.epoch === epoch && this.options.session() === owner.session && owner.session.cpu === owner.cpu &&
      owner.session.image === owner.image && owner.image.sha256 === owner.hash) this.options.error(error);
  }
  private sleepMatches(result: RunStep, snapshot: RunSnapshot): boolean {
    const metadata = result.sleep, sleep = snapshot.sleep;
    return snapshot.state === 'paused' && !!metadata && !!sleep && sleep.waitingForInterrupt === true && metadata.kind === 'wfi' && sleep.kind === 'wfi' &&
      uint32(metadata.address) && metadata.address <= 0xfffffffc && !(metadata.address & 1) &&
      metadata.resumePc === metadata.address + 2 && sleep.address === metadata.address && sleep.resumePc === metadata.resumePc &&
      result.pc === metadata.resumePc && snapshot.pc === metadata.resumePc;
  }
  private idle(snapshot: RunSnapshot): {ticks: number; quanta: number} {
    const sleep = snapshot.sleep;
    if (!sleep) return {ticks: 0, quanta: 0};
    if (!safeCount(sleep.idleTicks) || !safeCount(sleep.idleQuanta)) throw new Error('Invalid WFI idle counters.');
    if (Boolean(sleep.idleTicks) !== Boolean(sleep.idleQuanta) || sleep.idleTicks < sleep.idleQuanta ||
      sleep.idleTicks > sleep.idleQuanta * 1000000) throw new Error('Invalid cumulative WFI progress.');
    return {ticks: sleep.idleTicks, quanta: sleep.idleQuanta};
  }
  private turn(owner: Owner): void {
    try {
      const before = this.read(owner);
      if (!before) {
        if (this.same(owner)) this.finish(owner, owner.session.snapshot(), 'unavailable');
        else this.abandon(owner, 'ownership-changed');
        return;
      }
      if (this.mode === 'parked') {
        const parked = this.parked, idle = this.idle(before);
        if (!parked || before.instructions !== parked.instructions || idle.ticks !== parked.ticks || idle.quanta !== parked.quanta ||
          !this.sleepMatches({instructions: 0, totalInstructions: before.instructions, pc: before.pc,
            reason: 'stopped', sleep: parked.metadata}, before)) {this.finish(owner, before, 'parked-state-changed'); return;}
        if (this.publish(owner, before)) this.schedule(owner, limits.heartbeatMs);
        return;
      }
      if (this.calls >= limits.zeroInstructionCalls || this.ticks + limits.callbackTicks > limits.idleTicks ||
        this.quanta + limits.callbackQuanta > limits.idleQuanta) {this.finish(owner, before, 'work-limit'); return;}
      const beforeIdle = this.idle(before);
      this.calls++;
      const result = owner.session.step(limits.instructions);
      if (!this.same(owner)) {this.abandon(owner, 'ownership-changed'); return;}
      const after = owner.session.snapshot();
      if (!this.same(owner)) {this.abandon(owner, 'ownership-changed'); return;}
      if (!this.validOwner(owner) || !this.healthy(after, owner) || result.backendLost || result.reason === 'fault') {
        this.finish(owner, after, 'unavailable'); return;
      }
      if (!safeCount(result.instructions) || result.instructions > limits.instructions || result.totalInstructions !== after.instructions ||
        result.instructions !== after.instructions - before.instructions || result.pc !== after.pc ||
        result.reason === 'budget' && result.instructions !== limits.instructions) throw new Error('Invalid instruction accounting.');
      const afterIdle = this.idle(after), ticks = afterIdle.ticks - beforeIdle.ticks, quanta = afterIdle.quanta - beforeIdle.quanta;
      if (!safeCount(ticks) || !safeCount(quanta) || ticks > limits.callbackTicks || quanta > limits.callbackQuanta ||
        Boolean(ticks) !== Boolean(quanta) || ticks < quanta || ticks > quanta * 1000000) throw new Error('Invalid paired WFI progress.');
      this.ticks += ticks; this.quanta += quanta;
      if (result.instructions > 0) this.calls = this.ticks = this.quanta = 0;
      if (result.reason === 'stopped') {
        if (!this.sleepMatches(result, after)) {this.finish(owner, after, 'guest-stopped'); return;}
        const reason = after.sleep!.lastIdle?.reason;
        if (reason === 'sleep' && ticks === 0 && quanta === 0) {
          this.mode = 'parked'; this.parked = {instructions: after.instructions, ticks: afterIdle.ticks,
            quanta: afterIdle.quanta, metadata: {...result.sleep!}};
        }
        else if ((reason === 'sleep' || reason === 'quantum-limit') && (ticks > 0 || result.instructions > 0)) this.mode = 'runnable';
        else {this.finish(owner, after, 'guest-stopped'); return;}
      } else if (result.reason !== 'budget' || result.sleep && !this.sleepMatches(result, after)) {
        this.finish(owner, after, 'guest-stopped'); return;
      }
      const now = this.options.timers.now();
      if (!this.validOwner(owner)) {this.abandon(owner, 'ownership-changed'); return;}
      if (this.mode === 'parked' || now - this.lastPublication >= limits.heartbeatMs) {
        if (!this.publish(owner, after)) return;
      }
      this.schedule(owner, this.mode === 'parked' ? limits.heartbeatMs : 0);
    } catch (error) {this.fail(owner, error);}
  }
}

export const workerRunLimits = {...limits};
