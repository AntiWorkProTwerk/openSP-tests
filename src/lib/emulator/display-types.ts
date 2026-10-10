export type Width = 1 | 2 | 4;
export interface RamSpan { start: number; bytes: number }
export interface DisplayMemory {
  read(address: number, bytes: number): Uint8Array;
  write(address: number, bytes: Uint8Array): void;
}
export interface DisplayFixtures {
  quantumTicks: number;
  workCap: number;
  dmaClockReady: boolean;
  lpspiClockReady: boolean;
  sinByte: number;
}
export interface AudioFixtures {
  saiClockReady: boolean;
  externalClock: boolean;
  slotTicks: number;
  rxFrame: readonly number[];
}
export interface DisplayTransportOptions {
  memory: DisplayMemory;
  mappedRam: RamSpan | readonly RamSpan[];
  admittedRam: readonly RamSpan[];
  fixtures: DisplayFixtures;
  audioFixtures?: AudioFixtures;
  onPcs(active: boolean): void;
  onByte(byte: number): void;
  onIrq(irq: number, asserted: boolean): void;
}
export interface Diagnostic { code: string; channel?: number; address?: number; count: number }
export interface DisplayTransportStatus {
  owner: number;
  disposed: boolean;
  fixtures: Readonly<DisplayFixtures>;
  clocks: { dmaWord: number; lpspiWord: number; dmaEnabled: boolean; lpspiEnabled: boolean; saiEnabled?: boolean };
  audio?: ReturnType<import('./audio-sai.ts').AudioSai['status']>;
  creditTicks: number;
  phases: number;
  diagnostics: Diagnostic[];
  diagnosticOverflow: number;
  edma: ReturnType<import('./display-edma.ts').DisplayEdma['status']>;
  lpspi: ReturnType<import('./display-lpspi.ts').DisplayLpspi['status']>;
}
export interface DisplayTransportApi {
  handles(address: number, width?: Width): boolean;
  read(address: number, width?: Width): number | undefined;
  write(address: number, value: number, width?: Width): boolean;
  notifyClock(address: number, mergedWord: number): void;
  tick(cycles: number): void;
  reset(): void;
  dispose(): void;
  status(): DisplayTransportStatus;
}
export interface LpspiHooks {
  owner(): number;
  diagnostic(code: string, address?: number): void;
  onPcs(active: boolean): void;
  onByte(byte: number): void;
  onIrq(asserted: boolean): void;
  sinByte: number;
}
export class OwnershipChanged extends Error {}
export class DisplayBusFault extends Error {
  readonly code: 'range' | 'alignment' | 'read' | 'write';
  constructor(code: 'range' | 'alignment' | 'read' | 'write', message: string) { super(message); this.code = code; }
}
export const EDMA = 0x400e8000, DMAMUX = 0x400ec000, LPSPI = 0x403a0000;
export const DMA_CLOCK = 0x400fc07c, SPI_CLOCK = 0x400fc06c;
export const TCD_BASE = EDMA + 0x1000;
export const DREG = { CR: 0, ES: 4, ERQ: 0xc, EEI: 0x14, CEEI: 0x18, SEEI: 0x19,
  CERQ: 0x1a, SERQ: 0x1b, CDNE: 0x1c, SSRT: 0x1d, CERR: 0x1e, CINT: 0x1f,
  INT: 0x24, ERR: 0x2c, HRS: 0x34 } as const;
export const SREG = { VERID: 0, PARAM: 4, CR: 0x10, SR: 0x14, IER: 0x18, DER: 0x1c,
  CFGR0: 0x20, CFGR1: 0x24, DMR0: 0x30, DMR1: 0x34, CCR: 0x40, FCR: 0x58,
  FSR: 0x5c, TCR: 0x60, TDR: 0x64, RSR: 0x70, RDR: 0x74 } as const;
export const TCR = { CONT: 0x200000, CONTC: 0x100000, BYSW: 0x400000 } as const;
export const CSR = { START: 1, INTMAJOR: 2, INTHALF: 4, DREQ: 8, ESG: 16,
  MAJORELINK: 32, ACTIVE: 64, DONE: 128 } as const;

