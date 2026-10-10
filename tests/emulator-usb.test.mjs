import assert from 'node:assert/strict';
import test from 'node:test';
import { Rt1062UsbDevice, USB1_BASE, USB1_IRQ } from '../src/lib/emulator/usb.ts';

// Register/descriptor tests use synthetic RAM and host packets. They do not
// execute the R13/R16B binaries or establish physical USB/cache/timing fidelity.
const RAM = 0x80000000;
const HEADS = RAM + 0x800;
const DESCRIPTORS = RAM + 0x1000;
const PACKET = RAM + 0x2000;
const ACTIVE_IOC = 0x8080;

function fixture() {
  const bytes = new Uint8Array(0x50000);
  const interrupts = [];
  function position(address, length) {
    const offset = address - RAM;
    if (!Number.isInteger(offset) || offset < 0 || offset + length > bytes.length) {
      throw new Error(`Unmapped DMA address ${address.toString(16)}`);
    }
    return offset;
  }
  const bus = {
    readMemory(address, length) { return bytes.slice(position(address, length), address - RAM + length); },
    writeMemory(address, value) { bytes.set(value, position(address, value.length)); },
    irq(irq, asserted) { interrupts.push([irq, asserted]); },
  };
  const usb = new Rt1062UsbDevice(bus);
  const words = new DataView(bytes.buffer);
  const put = (address, value) => words.setUint32(position(address, 4), value >>> 0, true);
  const word = address => words.getUint32(position(address, 4), true);
  function head(endpoint, input) { return HEADS + (endpoint * 2 + Number(input)) * 64; }
  function queue(input, length, {
    endpoint = 0, descriptor = DESCRIPTORS + (endpoint * 2 + Number(input)) * 32,
    buffer = PACKET, next = 1, ioc = true, packetSize = 64, zeroTerminate = false,
    pages,
  } = {}) {
    const qh = head(endpoint, input);
    put(qh, (packetSize << 16) | (zeroTerminate ? 0 : 1 << 29) | (input ? 0 : 0x8000));
    put(qh + 8, descriptor);
    put(qh + 12, 0);
    put(descriptor, next);
    put(descriptor + 4, (length << 16) | 0x80 | (ioc ? 0x8000 : 0));
    for (let page = 0; page < 5; page++) {
      put(descriptor + 8 + page * 4,
        pages?.[page] ?? (page === 0 ? buffer : ((buffer & ~4095) + 4096 * page)));
    }
    usb.write(0x1b0, 1 << (endpoint + (input ? 16 : 0)));
    return { qh, descriptor };
  }
  // Original firmware initialization writes these values, then enables RUN.
  usb.write(0x140, 2);
  usb.write(0x1a8, 2);
  usb.write(0x90, 7);
  usb.write(0x1a4, 8);
  usb.write(0x184, 1 << 24);
  usb.write(0x158, HEADS);
  usb.write(0x1c0, 0x00800080);
  usb.write(0x140, 1);
  return { usb, bytes, bus, interrupts, put, word, head, queue };
}

test('USB1 uses documented base/IRQ and rejects unknown or crossing MMIO accesses', () => {
  const { usb } = fixture();
  assert.equal(USB1_BASE, 0x402e0000);
  assert.equal(USB1_IRQ, 113);
  assert.equal(usb.read(0x124), 0x88);
  assert.equal(usb.read(0x150), undefined);
  assert.equal(usb.write(0x150, 1), false);
  assert.equal(usb.read(0x141, 4), undefined);
  assert.equal(usb.write(0x143, 1, 2), false);
  assert.equal(usb.read(-4), undefined);
  usb.write(0x154, 0xffffffff);
  assert.equal(usb.read(0x154), 0xff000000);
  assert.equal(usb.read(0x157, 1), 255);
  usb.write(0x124, 0);
  assert.equal(usb.read(0x124), 0x88);
});

test('controller reset self-clears and masks the endpoint-list alignment', () => {
  const { usb } = fixture();
  assert.equal(usb.read(0x90), 7);
  assert.equal(usb.read(0x1a4), 8);
  usb.write(0x158, HEADS + 123);
  assert.equal(usb.read(0x158), HEADS);
  usb.write(0x1c4, 0x00cc0048);
  assert.equal(usb.read(0x1c4), 0x008c0008);
  usb.write(0x140, 2);
  assert.equal(usb.read(0x140), 0);
  assert.equal(usb.read(0x158), 0);
  assert.equal(usb.hostSetup(new Uint8Array(8)), false);
});

test('SETUP copies eight bytes to dQH+40 and breaks the setup tripwire', () => {
  const { usb, bus, put, head } = fixture();
  put(head(0, false), (64 << 16) | 0x8000);
  usb.write(0x140, (1 << 13) | 1);
  const request = Uint8Array.from([0x80, 6, 0, 1, 0, 0, 18, 0]);
  assert.equal(usb.hostSetup(request), true);
  assert.deepEqual(bus.readMemory(HEADS + 40, 8), request);
  assert.equal(usb.read(0x140) & (1 << 13), 0);
  assert.equal(usb.read(0x1ac), 1);
  assert.equal(usb.read(0x144) & 1, 1);
  usb.write(0x1ac, 1);
  assert.equal(usb.read(0x1ac), 0);
  assert.equal(usb.hostSetup(new Uint8Array(7)), false);
});

test('R13/R16B dTD layout sends descriptor bytes and updates DMA token/overlay', () => {
  const { usb, bus, queue, word } = fixture();
  const descriptor = Uint8Array.from([18, 1, 0, 2, 0, 0, 0, 64, 0xfe, 0xca, 0x4d, 0x40, 0x13, 0, 1, 2, 0, 1]);
  bus.writeMemory(PACKET, descriptor);
  const td = queue(true, descriptor.length);
  assert.equal(usb.read(0x1b0), 0);
  assert.equal(usb.read(0x1b8), 0x10000);
  assert.equal(word(td.qh + 4), td.descriptor);
  assert.deepEqual(usb.hostIn(), descriptor);
  assert.equal(word(td.descriptor + 4), 0x8000);
  assert.equal(word(td.qh + 12), 0x8000);
  assert.equal(usb.read(0x1b8), 0);
  assert.equal(usb.read(0x1bc), 0x10000);
  assert.equal(usb.read(0x144) & 1, 1);
  usb.write(0x1bc, 0x10000);
  usb.write(0x144, 1);
  assert.equal(usb.read(0x1bc), 0);
  assert.equal(usb.hostIn(), null);
});

test('OUT report DMA preserves all 64 payload bytes and retires ACTIVE', () => {
  const { usb, bus, queue, word } = fixture();
  const report = Uint8Array.from({ length: 64 }, (_, index) => index * 17);
  const td = queue(false, 64);
  assert.equal(word(td.descriptor + 4), (64 << 16) | ACTIVE_IOC);
  assert.equal(usb.hostOut(report), true);
  assert.deepEqual(bus.readMemory(PACKET, 64), report);
  assert.equal(word(td.descriptor + 4), 0x8000);
  assert.equal(usb.read(0x1bc), 1);
  assert.equal(usb.hostOut(report), false);
});

test('short OUT packets expose residual length for firmware validation', () => {
  const { usb, bus, queue, word } = fixture();
  bus.writeMemory(PACKET, new Uint8Array(64).fill(0xab));
  const td = queue(false, 64);
  assert.equal(usb.hostOut(new Uint8Array(10).fill(0x31)), true);
  assert.equal(word(td.descriptor + 4), (54 << 16) | 0x8000);
  assert.equal(usb.read(0x1b8), 0);
  assert.deepEqual(bus.readMemory(PACKET, 12), Uint8Array.from([...new Uint8Array(10).fill(0x31), 0xab, 0xab]));
});

test('host IN packets honor endpoint packet size until the dTD is complete', () => {
  const { usb, bus, queue, word } = fixture();
  const payload = Uint8Array.from({ length: 80 }, (_, index) => index);
  bus.writeMemory(PACKET, payload);
  const td = queue(true, 80, { packetSize: 32 });
  assert.deepEqual(usb.hostIn(), payload.slice(0, 32));
  assert.equal(word(td.descriptor + 4), (48 << 16) | ACTIVE_IOC);
  assert.equal(usb.read(0x1bc), 0);
  assert.deepEqual(usb.hostIn(), payload.slice(32, 64));
  assert.deepEqual(usb.hostIn(), payload.slice(64));
  assert.equal(usb.read(0x1bc), 0x10000);
});

test('IN and OUT DMA cross noncontiguous descriptor pages', () => {
  for (const input of [false, true]) {
    const { usb, bus, queue } = fixture();
    const pages = [RAM + 0x23ffb, RAM + 0x30000, RAM + 0x40000, RAM + 0x10000, RAM];
    const payload = Uint8Array.from({ length: 64 }, (_, index) => index * 3);
    if (input) {
      bus.writeMemory(pages[0], payload.slice(0, 5));
      bus.writeMemory(pages[1], payload.slice(5));
    }
    queue(input, 64, { pages });
    if (input) assert.deepEqual(usb.hostIn(), payload);
    else {
      assert.equal(usb.hostOut(payload), true);
      assert.deepEqual(bus.readMemory(pages[0], 5), payload.slice(0, 5));
      assert.deepEqual(bus.readMemory(pages[1], 59), payload.slice(5));
    }
  }
});

test('chained active descriptors continue without another firmware prime', () => {
  const { usb, bus, queue, put, word } = fixture();
  const second = DESCRIPTORS + 128;
  put(second, 1);
  put(second + 4, (4 << 16) | ACTIVE_IOC);
  put(second + 8, PACKET + 64);
  bus.writeMemory(PACKET, Uint8Array.from([1, 2, 3, 4]));
  bus.writeMemory(PACKET + 64, Uint8Array.from([5, 6, 7, 8]));
  const td = queue(true, 4, { next: second });
  assert.deepEqual(usb.hostIn(), Uint8Array.from([1, 2, 3, 4]));
  assert.equal(usb.read(0x1b8), 0x10000);
  assert.equal(word(td.qh + 4), second);
  assert.deepEqual(usb.hostIn(), Uint8Array.from([5, 6, 7, 8]));
  assert.equal(usb.read(0x1b8), 0);
});

test('all eight endpoint pairs own separate dQHs and completion bits', () => {
  const { usb, bus, queue } = fixture();
  let expected = 0;
  for (let endpoint = 0; endpoint < 8; endpoint++) {
    usb.write(0x1c0 + endpoint * 4, 0x00880088);
    for (const input of [false, true]) {
      const payload = Uint8Array.from([endpoint, Number(input)]);
      bus.writeMemory(PACKET, payload);
      queue(input, 2, { endpoint });
      if (input) assert.deepEqual(usb.hostIn(endpoint), payload);
      else assert.equal(usb.hostOut(payload, endpoint), true);
      expected |= 1 << (endpoint + (input ? 16 : 0));
      assert.equal(usb.read(0x1bc), expected);
    }
  }
  assert.equal(usb.hostIn(8), null);
  assert.equal(usb.hostOut(new Uint8Array(), -1), false);
});

test('automatic IN zero termination emits a ZLP after an exact packet multiple', () => {
  const { usb, queue } = fixture();
  queue(true, 64, { zeroTerminate: true });
  assert.equal(usb.hostIn().length, 64);
  assert.equal(usb.read(0x1bc), 0);
  assert.equal(usb.hostIn().length, 0);
  assert.equal(usb.read(0x1bc), 0x10000);
  assert.equal(usb.hostIn(), null);
});

test('staged device address activates only when EP0 status IN is acknowledged', () => {
  const { usb, queue } = fixture();
  usb.write(0x154, (7 << 25) | (1 << 24));
  queue(true, 4);
  usb.hostIn();
  assert.equal(usb.read(0x154), (7 << 25) | (1 << 24));
  queue(true, 0);
  assert.deepEqual(usb.hostIn(), new Uint8Array());
  assert.equal(usb.read(0x154), 7 << 25);
});

test('STALL blocks data tokens and a fresh SETUP clears STALL/old endpoint queues', () => {
  const { usb, queue, put } = fixture();
  put(HEADS, (64 << 16) | 0x8000);
  queue(true, 64);
  queue(false, 64);
  usb.write(0x1c0, usb.read(0x1c0) | 0x10001);
  assert.equal(usb.hostIn(), null);
  assert.equal(usb.hostOut(new Uint8Array(64)), false);
  assert.equal(usb.hostSetup(Uint8Array.from([0x80, 6, 0, 1, 0, 0, 18, 0])), true);
  assert.equal(usb.read(0x1b8), 0);
  assert.equal(usb.read(0x1c0) & 0x10001, 0);
});

test('flush synchronously cancels queues without fabricating completed packets', () => {
  const { usb, queue, word } = fixture();
  const input = queue(true, 64);
  queue(false, 64);
  usb.write(0x1b4, 0x10000);
  assert.equal(usb.read(0x1b4), 0);
  assert.equal(usb.read(0x1b8), 1);
  assert.equal(usb.read(0x1bc), 0);
  assert.equal(word(input.descriptor + 4), (64 << 16) | ACTIVE_IOC);
  assert.equal(usb.hostIn(), null);
  assert.equal(usb.hostOut(new Uint8Array(64)), true);
});

test('bus reset clears controller transaction state and preserves firmware RAM', () => {
  const { usb, bus, queue } = fixture();
  const stage = Uint8Array.from([0x53, 0x50, 0x31, 0x36, 5, 7, 11, 13]);
  bus.writeMemory(RAM + 0x40000, stage);
  queue(true, 64);
  queue(false, 64);
  usb.write(0x154, (8 << 25) | (1 << 24));
  assert.equal(usb.hostBusReset(), true);
  for (const register of [0x154, 0x1ac, 0x1b8, 0x1bc]) assert.equal(usb.read(register), 0);
  assert.equal(usb.read(0x144) & 64, 64);
  assert.deepEqual(bus.readMemory(RAM + 0x40000, stage.length), stage);
  assert.equal(usb.hostIn(), null);
});

test('enabled IRQ113 reflects latched W1C status and byte-lane acknowledgments', () => {
  const { usb, interrupts, queue } = fixture();
  usb.write(0x148, 1 | 64);
  queue(true, 0);
  usb.hostIn();
  assert.deepEqual(interrupts, [[113, true]]);
  usb.hostBusReset();
  usb.write(0x144, 1, 1);
  assert.equal(usb.read(0x144), 64);
  assert.deepEqual(interrupts, [[113, true]]);
  usb.write(0x144, 64, 1);
  assert.deepEqual(interrupts, [[113, true], [113, false]]);
  queue(true, 0, { ioc: false });
  usb.hostIn();
  assert.equal(usb.read(0x1bc), 0x10000);
  assert.equal(usb.read(0x144), 0);
});

test('oversized OUT packets halt the dTD and raise a controller error', () => {
  const { usb, queue, word } = fixture();
  const td = queue(false, 64);
  assert.equal(usb.hostOut(new Uint8Array(65)), false);
  assert.equal(word(td.descriptor + 4) & 0xff, 0x40);
  assert.equal(usb.read(0x144) & 2, 2);
  assert.equal(usb.read(0x1b8), 0);
});

test('unmapped DMA fails visibly and can be rebound before a new transfer', () => {
  const { usb, bus, queue, put, word } = fixture();
  const td = queue(true, 64, { buffer: 0x10000000 });
  assert.equal(usb.hostIn(), null);
  assert.equal(usb.read(0x144) & 2, 2);
  assert.equal(word(td.descriptor + 4) & 0xff, 0x60);
  usb.write(0x144, 2);
  put(HEADS + 8, 0x10000000);
  usb.write(0x1b0, 1);
  assert.equal(usb.read(0x144) & 2, 2);
  const unbound = new Rt1062UsbDevice();
  unbound.setMemoryCallbacks(bus);
  unbound.write(0x1a8, 2);
  unbound.write(0x1c0, 0x00800080);
  unbound.write(0x158, HEADS);
  unbound.write(0x140, 1);
  assert.equal(unbound.setup({ requestType: 0x80, request: 6, value: 0x100, index: 0, length: 18 }), true);
  assert.deepEqual(bus.readMemory(HEADS + 40, 8), Uint8Array.from([0x80, 6, 0, 1, 0, 0, 18, 0]));
});
