import { DisplayBusFault, OwnershipChanged, type DisplayMemory, type RamSpan } from './display-types.ts';
const typedLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
const copyBytes = Uint8Array.prototype.set;

/** Explicit active SDRAM/DTCM admission; peripheral endpoints never enter these callbacks. */
export class MappedDisplayBus {
  private readonly memory: DisplayMemory;
  private readonly mapped: readonly Readonly<RamSpan>[];
  private readonly admitted: readonly Readonly<RamSpan>[];
  constructor(memory: DisplayMemory, mapped: RamSpan | readonly RamSpan[],
    admitted: readonly RamSpan[], private readonly owner: () => number) {
    this.memory = Object.freeze({ read: memory.read.bind(memory), write: memory.write.bind(memory) });
    const spans = Array.isArray(mapped) ? mapped : [mapped as RamSpan];
    this.mapped = Object.freeze(spans.map(span => Object.freeze({ start: span.start, bytes: span.bytes })));
    this.admitted = Object.freeze(admitted.map(span => Object.freeze({ start: span.start, bytes: span.bytes })));
    if (!this.mapped.length) throw new RangeError('Active mapped RAM is required');
    for (const span of this.mapped) this.validateRegion(span);
    for (let i = 0; i < this.mapped.length; i++) for (let j = i + 1; j < this.mapped.length; j++)
      if (this.mapped[i].start < this.mapped[j].start + this.mapped[j].bytes &&
        this.mapped[j].start < this.mapped[i].start + this.mapped[i].bytes)
        throw new RangeError('Active mapped RAM spans overlap');
    if (!this.admitted.length) throw new RangeError('At least one admitted RAM span is required');
    for (const span of this.admitted) {
      this.validateRegion(span);
      if (!this.mapped.some(mapped => span.start >= mapped.start && span.start + span.bytes <= mapped.start + mapped.bytes))
        throw new RangeError('Admitted RAM exceeds active mapped capacity');
    }
  }
  private validateRegion(span: RamSpan): void {
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.bytes) || span.bytes <= 0 ||
      !((span.start >= 0x80000000 && span.start + span.bytes <= 0x84000000) ||
        (span.start >= 0x20000000 && span.start + span.bytes <= 0x20080000)))
      throw new RangeError('Mapped intervals must be finite SDRAM or DTCM spans');
  }
  check(address: number, bytes: number, alignment = 1): void {
    if (!Number.isSafeInteger(address) || !Number.isSafeInteger(bytes) || bytes <= 0 ||
      address < 0 || address > 0xffffffff || !Number.isSafeInteger(address + bytes) ||
      address + bytes > 0x100000000 ||
      !this.mapped.some(span => address >= span.start && address + bytes <= span.start + span.bytes) ||
      !this.admitted.some(span => address >= span.start && address + bytes <= span.start + span.bytes))
      throw new DisplayBusFault('range', 'Transfer span is outside admitted active RAM');
    if (![1, 2, 4, 32].includes(alignment) || address % alignment)
      throw new DisplayBusFault('alignment', 'Transfer address is misaligned');
  }
  read(address: number, bytes: number, alignment = 1): Uint8Array {
    this.check(address, bytes, alignment);
    const epoch = this.owner();
    let data: Uint8Array;
    try { data = this.memory.read(address, bytes); }
    catch (error) {
      if (epoch !== this.owner()) throw new OwnershipChanged();
      throw new DisplayBusFault('read', String(error));
    }
    if (epoch !== this.owner()) throw new OwnershipChanged();
    if (!(data instanceof Uint8Array) || typedLength.call(data) !== bytes)
      throw new DisplayBusFault('read', 'Memory callback returned a short or invalid span');
    const copy = new Uint8Array(bytes);
    copyBytes.call(copy, data);
    if (epoch !== this.owner()) throw new OwnershipChanged();
    return copy;
  }
  write(address: number, bytes: Uint8Array, alignment = 1): void {
    if (!(bytes instanceof Uint8Array)) throw new DisplayBusFault('write', 'Memory write requires a byte array');
    const epoch = this.owner();
    const length = typedLength.call(bytes) as number;
    this.check(address, length, alignment);
    const copy = new Uint8Array(length);
    copyBytes.call(copy, bytes);
    if (epoch !== this.owner()) throw new OwnershipChanged();
    try { this.memory.write(address, copy); }
    catch (error) {
      if (epoch !== this.owner()) throw new OwnershipChanged();
      throw new DisplayBusFault('write', String(error));
    }
    if (epoch !== this.owner()) throw new OwnershipChanged();
  }
}

