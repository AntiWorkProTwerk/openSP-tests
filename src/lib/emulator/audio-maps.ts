import type { RamSpan } from './display-types.ts';
interface ActiveRegion { name: string; address: number; bytes: number; permissions: number }

/** Accept the actual CPU.memoryMap rows; no CPU options or peripheral spans are inputs. */
export function admitStockAudioRam(memoryMap: readonly ActiveRegion[]): {
  mappedRam: readonly Readonly<RamSpan>[]; admittedRam: readonly Readonly<RamSpan>[];
} {
  function region(name: string, start: number, maximum: number, minimum: number): Readonly<RamSpan> {
    const rows = memoryMap.filter(row => row.name === name);
    if (rows.length !== 1) throw new RangeError(`One active ${name} map is required`);
    const { address, bytes, permissions } = rows[0];
    if (address !== start || !Number.isSafeInteger(bytes) || bytes < minimum || bytes > maximum ||
      bytes % 0x1000 || !Number.isInteger(permissions) || (permissions & 3) !== 3)
      throw new RangeError(`The active ${name} map cannot admit this fixture`);
    return Object.freeze({ start: address, bytes });
  }
  const sdram = region('SDRAM', 0x80000000, 0x4000000, 0x10000);
  const dtcm = region('DTCM', 0x20000000, 0x80000, 0x10000);
  return Object.freeze({ mappedRam: Object.freeze([sdram, dtcm]),
    admittedRam: Object.freeze([sdram, Object.freeze({ start: 0x20000000, bytes: 0x9000 })]) });
}
