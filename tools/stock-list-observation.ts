/** Bounded passive reads for the local stock diagnostic tool; no added guest execution. */
export const STOCK_SHA256 = '4a3d67711e14dcc97d50249a4eee7dd6df0251a2f37757cbbe2556c233730d80';
export const MAXIMUM_DISTINCT_BYTES = 66;
const OCRAM_BEGIN = 0x20200000, OCRAM_END = 0x202c0000;
const SDRAM_BEGIN = 0x80000000, SDRAM_END = 0x84000000;
const HEAD = 0x202bcf30;
const scalarNames = ['pc', 'xpsr', 'lr', 'sp', 'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r7'] as const;
type ScalarName = typeof scalarNames[number];
type MaskName = 'basepri' | 'primask' | 'faultmask' | 'control';
interface MappedRegion {name: string; address: number; bytes: number; permissions: number}
export interface PassiveCpu {
  readonly backendFailed: boolean;
  readonly memoryMap: readonly MappedRegion[];
  readRegister(name: string): number;
  readMemory(address: number, length: number): Uint8Array;
}
/** Caller supplies the retained checkpoint from a completed ordinary slice. */
export interface PassiveCheckpoint {
  firmwareSha256: string;
  wholeStockImage: boolean;
  scatterVerified: boolean;
  state: string;
  reason: string;
  sliceInstructions: number;
  cpuBackendFailed: boolean;
  mailboxCached: boolean;
  scalars: Readonly<Record<ScalarName, number>>;
}
interface Range {address: number; bytes: number}
interface FieldSpec extends Range {name: string; members: readonly {name: string; offset: number; bytes: 1 | 4}[]}
interface ScalarField extends Range {values: Record<string, number>}
export interface PassiveObservation {
  schema: 'opensp-private-stock-list-observation-v1';
  status: 'observed' | 'partial' | 'ineligible' | 'unavailable';
  reason?: string;
  scalars?: Record<ScalarName, number>;
  registers: Partial<Record<MaskName, number>>;
  fields: Record<string, ScalarField>;
  ranges: Array<Range & {completed: boolean}>;
  requestedBytes: number;
  distinctBytes: number;
  relationships?: Record<string, number | boolean>;
  error?: {operation: string; code: string};
}
class ObservationFailure extends Error {
  readonly operation: string;
  readonly code: string;
  constructor(operation: string, code: string) {super(code); this.operation = operation; this.code = code;}
}
const uint32 = (value: unknown): value is number => typeof value === 'number' &&
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
function coalesce(ranges: readonly Range[]): Range[] {
  const result: Range[] = [];
  for (const range of [...ranges].sort((a, b) => a.address - b.address)) {
    const previous = result.at(-1);
    if (previous && range.address <= previous.address + previous.bytes) {
      previous.bytes = Math.max(previous.address + previous.bytes, range.address + range.bytes) - previous.address;
    } else result.push({...range});
  }
  return result;
}
const wordSpec = (name: string, address: number, members: readonly string[]): FieldSpec => ({name, address,
  bytes: members.length * 4, members: members.map((name, index) => ({name, offset: index * 4, bytes: 4}))});

export function observeStockList(cpu: PassiveCpu, checkpoint: PassiveCheckpoint): PassiveObservation {
  const result: PassiveObservation = {schema: 'opensp-private-stock-list-observation-v1', status: 'ineligible',
    registers: {}, fields: {}, ranges: [], requestedBytes: 0, distinctBytes: 0};
  const refuse = (reason: string) => {result.reason = reason; return result;};
  if (checkpoint.firmwareSha256 !== STOCK_SHA256) return refuse('firmware-mismatch');
  if (checkpoint.wholeStockImage !== true || checkpoint.scatterVerified !== true) return refuse('whole-stock-checkpoint-required');
  if (checkpoint.state !== 'paused' || checkpoint.reason !== 'budget' || checkpoint.sliceInstructions !== 250000) return refuse('ordinary-completed-slice-required');
  if (checkpoint.cpuBackendFailed !== false || checkpoint.mailboxCached !== false || cpu.backendFailed !== false) {
    result.status = 'unavailable'; return refuse('healthy-uncached-backend-required');
  }
  if (!checkpoint.scalars || scalarNames.some(name => !uint32(checkpoint.scalars[name]))) return refuse('invalid-checkpoint-scalars');
  const scalars = Object.fromEntries(scalarNames.map(name => [name, checkpoint.scalars[name]])) as Record<ScalarName, number>;
  if ((scalars.pc & 1) || scalars.pc < 0xd912 || scalars.pc > 0xd922) return refuse('outside-list-checkpoint');
  if (scalars.r3 !== HEAD) return refuse('unexpected-head-pointer');
  const mapped = (address: number, bytes: number, name: 'OCRAM' | 'SDRAM', wordAligned = true) => {
    const begin = name === 'OCRAM' ? OCRAM_BEGIN : SDRAM_BEGIN, end = name === 'OCRAM' ? OCRAM_END : SDRAM_END;
    return uint32(address) && Number.isSafeInteger(bytes) && bytes > 0 && (!wordAligned || address % 4 === 0) &&
      address >= begin && address + bytes <= end && Array.isArray(cpu.memoryMap) && cpu.memoryMap.length <= 32 &&
      cpu.memoryMap.some(region => region.name === name && uint32(region.address) && Number.isSafeInteger(region.bytes) &&
        region.bytes > 0 && region.address + region.bytes <= 0x100000000 && uint32(region.permissions) &&
        (region.permissions & 1) !== 0 && address >= region.address && address + bytes <= region.address + region.bytes);
  };
  const cursorMembers = scalars.r1 === HEAD ? ['next', 'previous'] : ['next', 'previous', 'deadline'];
  const specs: FieldSpec[] = [
    wordSpec('timerState', 0x202bcf20, ['tickLow', 'tickHigh']),
    wordSpec('listHead', HEAD, ['next', 'previous']),
    wordSpec('insertionNode', scalars.r0, ['next', 'previous', 'deadline', 'callback', 'callbackArgument']),
    wordSpec('cursor', scalars.r1, cursorMembers),
    wordSpec('currentTask', 0x202bbbfc, ['pointer']),
    wordSpec('selectedTask', 0x202bbc00, ['pointer']),
    wordSpec('guard202BBBF8', 0x202bbbf8, ['value']),
    wordSpec('guard80245764', 0x80245764, ['value']),
  ];
  if (specs.some(spec => !mapped(spec.address, spec.bytes, spec.name === 'guard80245764' ? 'SDRAM' : 'OCRAM'))) return refuse('invalid-or-unmapped-planned-range');
  result.scalars = scalars;
  const cache: Array<Range & {data: Uint8Array}> = [];
  const cached = (range: Range) => cache.find(row => range.address >= row.address && range.address + range.bytes <= row.address + row.bytes);
  const populate = () => {
    for (const spec of specs) {
      const row = cached(spec); if (!row) continue;
      const view = new DataView(row.data.buffer, row.data.byteOffset, row.data.byteLength), values: Record<string, number> = {};
      for (const member of spec.members) {
        const offset = spec.address - row.address + member.offset;
        values[member.name] = member.bytes === 1 ? view.getUint8(offset) : view.getUint32(offset, true);
      }
      result.fields[spec.name] = {address: spec.address, bytes: spec.bytes, values};
    }
  };
  const healthy = (operation: string) => {
    if (cpu.backendFailed !== false) throw new ObservationFailure(operation, 'backend-unavailable');
  };
  const readRanges = (ranges: readonly Range[]) => {
    for (const range of coalesce(ranges.filter(range => !cached(range)))) {
      healthy('read-memory');
      const distinct = coalesce([...result.ranges, range]).reduce((sum, row) => sum + row.bytes, 0);
      if (result.requestedBytes + range.bytes > MAXIMUM_DISTINCT_BYTES || distinct > MAXIMUM_DISTINCT_BYTES) throw new ObservationFailure('read-memory', 'byte-budget');
      const observed = {...range, completed: false}; result.ranges.push(observed);
      result.requestedBytes += range.bytes; result.distinctBytes = distinct;
      let data: Uint8Array;
      try {data = cpu.readMemory(range.address, range.bytes);}
      catch {throw new ObservationFailure('read-memory', cpu.backendFailed ? 'backend-unavailable' : 'adapter-error');}
      healthy('read-memory');
      if (!(data instanceof Uint8Array) || data.byteLength !== range.bytes) throw new ObservationFailure('read-memory', 'invalid-memory-result');
      cache.push({...range, data: data.slice()}); observed.completed = true; populate();
    }
    populate();
  };
  try {
    for (const name of ['basepri', 'primask', 'faultmask', 'control'] as const) {
      healthy(`read-register:${name}`);
      let value: number;
      try {value = cpu.readRegister(name);}
      catch {throw new ObservationFailure(`read-register:${name}`, cpu.backendFailed ? 'backend-unavailable' : 'adapter-error');}
      healthy(`read-register:${name}`);
      if (!uint32(value)) throw new ObservationFailure(`read-register:${name}`, 'invalid-register-result');
      result.registers[name] = value;
    }
    readRanges(specs);
    const pointer = result.fields.currentTask.values.pointer;
    if (!mapped(pointer, 4, 'OCRAM') || !mapped(pointer + 35, 1, 'OCRAM', false) || !mapped(pointer + 96, 1, 'OCRAM', false)) {
      result.status = 'partial'; result.reason = 'invalid-current-task-fields'; return result;
    }
    const taskSpecs: FieldSpec[] = [
      {name: 'currentTaskState', address: pointer + 35, bytes: 1, members: [{name: 'state', offset: 0, bytes: 1}]},
      {name: 'currentTaskFlags', address: pointer + 96, bytes: 1, members: [{name: 'flags', offset: 0, bytes: 1}]},
    ];
    specs.push(...taskSpecs); readRanges(taskSpecs);
    const node = result.fields.insertionNode.values, cursor = result.fields.cursor.values, head = result.fields.listHead.values;
    result.relationships = {insertionEqualsCursor: scalars.r0 === scalars.r1, cursorEqualsHead: scalars.r1 === HEAD,
      insertionMatchesCurrentTaskNode: scalars.r0 === pointer + 76, headNextEqualsInsertion: head.next === scalars.r0,
      headPreviousEqualsInsertion: head.previous === scalars.r0, insertionNextEqualsInsertion: node.next === scalars.r0,
      insertionPreviousEqualsInsertion: node.previous === scalars.r0, insertionDeadlineRelative: (node.deadline - scalars.r2) >>> 0};
    if (cursor.deadline !== undefined) {
      const relative = (cursor.deadline - scalars.r2) >>> 0;
      result.relationships.cursorDeadlineRelative = relative;
      result.relationships.insertionBeforeCursorUnsigned = ((node.deadline - scalars.r2) >>> 0) < relative;
    }
    healthy('observation-complete'); result.status = 'observed'; return result;
  } catch (error) {
    result.status = 'unavailable';
    result.error = error instanceof ObservationFailure ? {operation: error.operation, code: error.code} : {operation: 'observation', code: 'observer-error'};
    return result;
  }
}

interface CheckpointCpu extends PassiveCpu {readonly totalInstructions: number}
export interface StockObservationSession {readonly cpu: CheckpointCpu; readonly state: string}
interface CompletedStockSlice {reason: string; instructions: number; totalInstructions: number; pc: number}
interface StockSliceHistory {
  cpu: CheckpointCpu;
  previousTotalInstructions: number;
  requestedSliceInstructions: number;
  image: {sha256: string; format: string; bytes: number; suppliedHandoff: boolean; reconstructedRuntimeSubstitution: boolean};
  scatter: {passed: boolean; checkpointReached: boolean; checkpoint: string;
    regionChecks: readonly {index: number; matches: boolean; actualSha256: string; expectedSha256: string}[]};
}
interface RetainedStockSnapshot {
  state: string;
  firmwareHash: string;
  format: string;
  instructions: number;
  pc: unknown;
  cpuBackendFailed: boolean;
  mailboxCached: boolean;
  powered: boolean;
  fault?: unknown;
  architecture: {available: boolean; xpsr: unknown; registers: Readonly<Record<string, unknown>>};
  frames: number;
  flash: {commandCount: number};
  exceptions?: unknown;
  pendingInterrupts?: readonly number[];
}
const canonicalWord = (value: unknown): number | undefined => typeof value === 'string' &&
  /^0x[0-9a-f]{8}$/.test(value) ? Number.parseInt(value.slice(2), 16) : undefined;
const counter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Bind only to the same paused CPU and retained snapshot after its ordinary slice. */
export function observeCompletedStockCheckpoint(session: StockObservationSession, checkpoint: RetainedStockSnapshot,
  step: CompletedStockSlice, history: StockSliceHistory): PassiveObservation | undefined {
  const cpu = session.cpu;
  if (history.cpu !== cpu || session.state !== 'paused' || checkpoint.state !== 'paused' ||
    cpu.backendFailed !== false || checkpoint.cpuBackendFailed !== false || checkpoint.mailboxCached !== false ||
    checkpoint.powered !== true || checkpoint.fault !== undefined) return undefined;
  const image = history.image, scatter = history.scatter;
  if (image.sha256 !== STOCK_SHA256 || image.format !== 'app1' || image.bytes !== 2652672 || image.suppliedHandoff !== true ||
    image.reconstructedRuntimeSubstitution !== false || checkpoint.firmwareHash !== STOCK_SHA256 || checkpoint.format !== 'app1') return undefined;
  if (scatter.passed !== true || scatter.checkpointReached !== true || scatter.checkpoint !== '0x60080622' ||
    !Array.isArray(scatter.regionChecks) || scatter.regionChecks.length !== 12 ||
    new Set(scatter.regionChecks.map(region => region.index)).size !== 12 || scatter.regionChecks.some(region =>
      !Number.isInteger(region.index) || region.index < 0 || region.index > 11 || region.matches !== true ||
      !/^[0-9a-f]{64}$/.test(region.actualSha256) || region.actualSha256 !== region.expectedSha256)) return undefined;
  if (history.requestedSliceInstructions !== 250000 || step.reason !== 'budget' || step.instructions !== 250000 ||
    !counter(history.previousTotalInstructions) || !counter(step.totalInstructions) || !counter(checkpoint.instructions) ||
    !counter(cpu.totalInstructions) || !Number.isSafeInteger(history.previousTotalInstructions + 250000) ||
    step.totalInstructions !== history.previousTotalInstructions + 250000 || checkpoint.instructions !== step.totalInstructions ||
    cpu.totalInstructions !== step.totalInstructions) return undefined;
  if (checkpoint.architecture?.available !== true || !checkpoint.architecture.registers) return undefined;
  const scalars = {} as Record<ScalarName, number>;
  for (const name of scalarNames) {
    const raw = name === 'pc' ? checkpoint.pc : name === 'xpsr' ? checkpoint.architecture.xpsr : checkpoint.architecture.registers[name];
    const value = canonicalWord(raw); if (value === undefined) return undefined; scalars[name] = value;
  }
  if (!uint32(step.pc) || step.pc !== scalars.pc || (scalars.pc & 1) || scalars.pc < 0xd912 ||
    scalars.pc > 0xd922 || scalars.r3 !== HEAD) return undefined;
  return observeStockList(cpu, {firmwareSha256: image.sha256, wholeStockImage: true, scatterVerified: true,
    state: checkpoint.state, reason: step.reason, sliceInstructions: step.instructions,
    cpuBackendFailed: checkpoint.cpuBackendFailed, mailboxCached: checkpoint.mailboxCached, scalars});
}

/** Keep every compact checkpoint and its existing exception evidence, including ineligible slices. */
export function retainStockCheckpoint(session: StockObservationSession, checkpoint: RetainedStockSnapshot,
  step: CompletedStockSlice, history: StockSliceHistory) {
  const listObservation = observeCompletedStockCheckpoint(session, checkpoint, step, history);
  return {pc: checkpoint.pc, architecture: checkpoint.architecture, reason: step.reason, totalInstructions: checkpoint.instructions,
    displayFrames: checkpoint.frames, flashCommandCount: checkpoint.flash.commandCount,
    cpuBackendFailed: checkpoint.cpuBackendFailed, powered: checkpoint.powered, state: checkpoint.state,
    mailboxCached: checkpoint.mailboxCached, exceptions: structuredClone(checkpoint.exceptions),
    pendingInterrupts: structuredClone(checkpoint.pendingInterrupts), ...(listObservation ? {listObservation} : {})};
}
