/** One synthetic WFI idle quantum; this helper never executes instructions. */
export interface WfiIdleCPU {
  readonly backendFailed: boolean;
  /** Observes the current register value. Reset/replacement invalidates ownership. */
  readRegister(name: string): number;
}
export interface OwnedWfiSleep {
  readonly cpu: WfiIdleCPU;
  readonly generation: number;
  readonly metadata: {readonly kind: 'wfi'; readonly address: number; readonly resumePc: number};
}
export interface WfiIdleOwner {
  readonly cpu: WfiIdleCPU;
  readonly generation: number;
  readonly state: string;
}
export interface WfiIdleBoard {
  isPowered(): boolean;
  tick(ticks: number): void;
}
export interface WfiIdleClock {
  readonly cpu: object;
  hasWfiWakePending(): boolean;
  hasDeliverablePending(): boolean;
  processorTicksToWfiWake(): number | null;
  advanceSysTick(ticks: number): number;
}
export interface WfiIdleCounters {readonly ticks: number; readonly quanta: number}
export interface WfiIdleResult {
  readonly reason: 'wake' | 'sleep' | 'stopped' | 'fault';
  readonly deliverable: boolean;
  readonly sleep?: OwnedWfiSleep;
  /** Ticks completed by both models, separate from instruction starts. */
  readonly idleTicks: number;
  /** A failing callback can leave board-only effects; no rollback is claimed. */
  readonly attemptedTicks: number;
  readonly counters: WfiIdleCounters;
  readonly instructions: 0;
  readonly detail?: string;
}

export function advanceWfiIdle(
  sleep: OwnedWfiSleep,
  owner: WfiIdleOwner,
  board: WfiIdleBoard,
  clock: WfiIdleClock,
  counters: WfiIdleCounters = {ticks: 0, quanta: 0},
  maxTicks = 1000000,
): WfiIdleResult {
  if (!Number.isSafeInteger(maxTicks) || maxTicks < 1 || maxTicks > 1000000) {
    throw new RangeError('WFI idle quantum must be 1..1000000 synthetic ticks.');
  }
  const initialTicks = counters.ticks, initialQuanta = counters.quanta;
  if (![initialTicks, initialQuanta].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError('WFI idle counters must be nonnegative safe integers.');
  }
  let idleTicks = 0, attemptedTicks = 0;
  const result = (reason: WfiIdleResult['reason'], detail?: string, deliverable = false): WfiIdleResult => ({
    reason, deliverable, ...(reason === 'sleep' ? {sleep} : {}), idleTicks, attemptedTicks,
    counters: {ticks: initialTicks + idleTicks, quanta: initialQuanta + Number(idleTicks > 0)},
    instructions: 0, ...(detail ? {detail} : {}),
  });
  const ownershipIssue = (): string | undefined => {
    if (owner.cpu !== sleep.cpu || clock.cpu !== sleep.cpu) return 'CPU ownership changed';
    if (!Number.isSafeInteger(sleep.generation) || sleep.generation < 0 || owner.generation !== sleep.generation) return 'Session generation changed';
    if (owner.state !== 'paused') return 'Session is not paused';
    if (sleep.cpu.backendFailed) return 'CPU backend is unavailable';
    return undefined;
  };
  const powerIssue = (): string | undefined => {
    const powered = board.isPowered();
    // The board callback can reset or replace the session owner.
    return ownershipIssue() ?? (powered ? undefined : 'Board is powered off');
  };
  const guard = (): string | undefined => {
    const beforePower = ownershipIssue();
    if (beforePower) return beforePower;
    const afterPower = powerIssue();
    if (afterPower) return afterPower;
    const {kind, address, resumePc} = sleep.metadata;
    if (kind !== 'wfi' || !Number.isInteger(address) || address < 0 || address > 0xfffffffc
      || (address & 1) || resumePc !== address + 2) return 'Sleep metadata is inconsistent';
    // Run the final board callback before observing the current resume PC.
    const beforePc = powerIssue();
    if (beforePc) return beforePc;
    const pc = sleep.cpu.readRegister('pc');
    // Nested reset/replacement must invalidate this owned sleep generation.
    const afterPc = ownershipIssue();
    if (afterPc) return afterPc;
    if (pc !== resumePc) return 'Resume PC changed';
    return undefined;
  };
  const wake = (): WfiIdleResult => {
    const issue = guard();
    if (issue) return result('stopped', issue);
    const deliverable = clock.hasDeliverablePending();
    const afterQuery = guard();
    return afterQuery ? result('stopped', afterQuery) : result('wake', undefined, deliverable);
  };
  try {
    const issue = guard();
    if (issue) return result('stopped', issue);
    if (clock.hasWfiWakePending()) return wake();
    const afterWakeQuery = guard();
    if (afterWakeQuery) return result('stopped', afterWakeQuery);
    const next = clock.processorTicksToWfiWake();
    const afterEventQuery = guard();
    if (afterEventQuery) return result('stopped', afterEventQuery);
    if (next === null) return result('sleep');
    if (!Number.isSafeInteger(next) || next < 1) throw new RangeError('Next WFI event must have a positive safe tick distance.');
    const ticks = Math.min(next, maxTicks);
    if (!Number.isSafeInteger(initialTicks + ticks) || !Number.isSafeInteger(initialQuanta + 1)) {
      throw new RangeError('WFI idle counters exceed safe integer range.');
    }
    attemptedTicks = ticks;
    board.tick(ticks);
    const afterBoardTick = guard();
    if (afterBoardTick) return result('stopped', afterBoardTick);
    clock.advanceSysTick(ticks);
    idleTicks = ticks;
    const afterClockTick = guard();
    if (afterClockTick) return result('stopped', afterClockTick);
    if (clock.hasWfiWakePending()) return wake();
    const afterFinalQuery = guard();
    return afterFinalQuery ? result('stopped', afterFinalQuery) : result('sleep');
  } catch (error) {
    return result(sleep.cpu.backendFailed ? 'stopped' : 'fault', error instanceof Error ? error.message : String(error));
  }
}
