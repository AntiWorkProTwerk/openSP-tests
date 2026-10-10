import test from 'node:test';
import assert from 'node:assert/strict';
import { MappedDisplayBus } from '../src/lib/emulator/display-bus.ts';
import { DisplayBusFault, OwnershipChanged } from '../src/lib/emulator/display-types.ts';

const RAM = 0x80000000;
function setup() {
  let owner = 0;
  const calls = [], ram = new Uint8Array(128);
  const memory = { read(address, size) { calls.push(['read', address, size]); return ram.slice(address - RAM, address - RAM + size); },
    write(address, bytes) { calls.push(['write', address, [...bytes]]); ram.set(bytes, address - RAM); } };
  const mapped = { start: RAM, bytes: 128 }, admitted = [{ start: RAM + 16, bytes: 64 }];
  const bus = new MappedDisplayBus(memory, mapped, admitted, () => owner);
  return { bus, memory, mapped, admitted, ram, calls, reset: () => owner++ };
}

test('bus owns admission spans and callback identities', () => {
  const f = setup(); f.mapped.start = 0x40000000; f.admitted[0].start = 0x40000000; f.admitted.push({start: RAM, bytes: 128});
  f.memory.write = () => { throw new Error('replacement must not run'); };
  f.bus.write(RAM + 16, new Uint8Array([0x33]));
  assert.equal(f.ram[16], 0x33);
  assert.throws(() => f.bus.read(0x40000000, 1), DisplayBusFault);
  assert.throws(() => f.bus.read(RAM, 1), DisplayBusFault);
});
test('bus rejects entire out-of-range, wrapped and misaligned spans before callbacks', () => {
  const f = setup();
  for (const [address, size, alignment] of [[RAM + 79, 2, 1], [RAM + 17, 4, 4], [0xffffffff, 2, 1], [RAM + 16, 0, 1], [RAM + 16.5, 1, 1]])
    assert.throws(() => f.bus.read(address, size, alignment), DisplayBusFault);
  assert.deepEqual(f.calls, []);
  assert.equal(f.bus.read(RAM + 32, 32, 32).length, 32);
});
test('bus requires exact-length reads and returns independent intrinsic copies', () => {
  let returned = new Uint8Array([1, 2, 3, 4]);
  const bus = new MappedDisplayBus({read: () => returned, write() {}}, {start: RAM, bytes: 128}, [{start: RAM, bytes: 128}], () => 0);
  assert.throws(() => bus.read(RAM, 3), DisplayBusFault);
  const owned = bus.read(RAM, 4); returned.fill(9); assert.deepEqual([...owned], [1, 2, 3, 4]);
  returned = new (class extends Uint8Array { slice() { throw new Error('subclass slice'); } get byteLength() { throw new Error('subclass length'); } })([5, 6]);
  assert.deepEqual([...bus.read(RAM, 2)], [5, 6]);
});
test('bus write copies subclasses without overridable length or slice methods', () => {
  const f = setup();
  const source = new (class extends Uint8Array { slice() { f.reset(); throw new Error('must not call'); }
    get byteLength() { f.reset(); throw new Error('must not call'); } })([7, 8]);
  f.bus.write(RAM + 16, source); source.fill(0);
  assert.deepEqual([...f.ram.slice(16, 18)], [7, 8]);
  for (const invalid of [new Uint16Array([1]), new DataView(new ArrayBuffer(2)), [1, 2]])
    assert.throws(() => f.bus.write(RAM + 16, invalid), error => error instanceof DisplayBusFault && error.code === 'write');
  assert.equal(f.calls.length, 1);
});
test('bus stops after callback ownership changes while retaining accepted earlier writes', () => {
  let owner = 0, writes = 0, accepted;
  const bus = new MappedDisplayBus({read() { owner++; return new Uint8Array(1); },
    write(_address, bytes) { writes++; accepted = bytes; owner++; }}, {start: RAM, bytes: 128}, [{start: RAM, bytes: 128}], () => owner);
  assert.throws(() => bus.read(RAM, 1), OwnershipChanged);
  assert.throws(() => bus.write(RAM, new Uint8Array([9])), OwnershipChanged);
  assert.equal(writes, 1); assert.deepEqual([...accepted], [9]);
});
test('bus converts callback failures to named read and write faults', () => {
  const bus = new MappedDisplayBus({read() { throw new Error('backend'); }, write() { throw new Error('backend'); }},
    {start: RAM, bytes: 128}, [{start: RAM, bytes: 128}], () => 0);
  assert.throws(() => bus.read(RAM, 1), error => error instanceof DisplayBusFault && error.code === 'read');
  assert.throws(() => bus.write(RAM, new Uint8Array([1])), error => error instanceof DisplayBusFault && error.code === 'write');
});
