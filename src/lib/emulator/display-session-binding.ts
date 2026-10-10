import type {SPBoard} from './board.ts';
import type {ArmCPU} from './cpu.ts';

// Explicit synthetic transport inputs. They are not measured hardware timing,
// clock readiness or an electrical SIN observation.
export const DISPLAY_FIXTURES = Object.freeze({quantumTicks: 1, workCap: 64,
  dmaClockReady: true, lpspiClockReady: true, sinByte: 0});

export function bindDisplayTransport(board: SPBoard, cpu: Pick<ArmCPU, 'memoryMap'>): void {
  const rows = cpu.memoryMap.filter(row => row.name === 'SDRAM');
  if (rows.length !== 1) throw new Error('Display transport needs one actual mapped SDRAM region.');
  const row = rows[0];
  if (row.address !== 0x80000000 || !Number.isSafeInteger(row.bytes) || row.bytes < 0x10000 ||
    row.bytes > 0x04000000 || row.bytes % 0x1000 !== 0 || (row.permissions & 3) !== 3)
    throw new Error('Display transport needs an owned readable/writable SDRAM mapping.');
  board.configureDisplayTransport({mappedRam: {start: row.address, bytes: row.bytes},
    admittedRam: [{start: row.address, bytes: row.bytes}], fixtures: {...DISPLAY_FIXTURES}});
}
