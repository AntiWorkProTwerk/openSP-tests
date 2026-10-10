import assert from 'node:assert/strict';
import test from 'node:test';
import { SPBoard } from '../src/lib/emulator/board.ts';
import { OwnershipChanged, EDMA, DMAMUX, LPSPI, DMA_CLOCK, SPI_CLOCK, SREG as S, TCR } from '../src/lib/emulator/display-types.ts';

const GPIO = 0x401bc000, MUX = 0x401f813c, GPR27 = 0x400ac06c;
const CS = 1, DC = 2, MOSI = 4, CLK = 8, RESET = 1024, WIRES = 0x40f;
function options(sinByte = 0x5a) {
  return { mappedRam: {start: 0x80000000, bytes: 0x4000},
    admittedRam: [{start: 0x80000000, bytes: 0x4000}],
    fixtures: {quantumTicks: 1, workCap: 64, dmaClockReady: true, lpspiClockReady: true, sinByte} };
}
function wires(board, peripheral = false) {
  board.write(GPIO + 4, WIRES);
  board.write(GPR27, 0);
  for (const pin of [0, 1, 2, 3, 10]) board.write(MUX + pin * 4, peripheral && [0, 2, 3].includes(pin) ? 3 : 5);
  board.write(GPIO + 0x84, CS | RESET);
}
function gpioBytes(board, bytes, data) {
  board.write(GPIO + (data ? 0x84 : 0x88), DC);
  board.write(GPIO + 0x88, CS);
  for (const byte of bytes) for (let bit = 7; bit >= 0; bit--) {
    board.write(GPIO + 0x88, CLK);
    board.write(GPIO + ((byte & (1 << bit)) ? 0x84 : 0x88), MOSI);
    board.write(GPIO + 0x84, CLK);
  }
  board.write(GPIO + 0x88, CLK);
  board.write(GPIO + 0x84, CS);
}
function serialBoard(board = new SPBoard(), sinByte = 0x5a, routed = true) {
  board.configureDisplayTransport(options(sinByte));
  if (routed) wires(board, true);
  board.write(DMA_CLOCK, 0xc0); board.write(SPI_CLOCK, 0xc0);
  board.write(LPSPI + S.CFGR1, 1); board.write(LPSPI + S.CR, 1);
  return board;
}
function serialBytes(board, bytes, data, continuous = true) {
  board.write(GPIO + (data ? 0x84 : 0x88), DC);
  board.write(LPSPI + S.TCR, 7 | TCR.BYSW | (continuous ? TCR.CONT : 0));
  for (const byte of bytes) board.write(LPSPI + S.TDR + 3, byte, 1);
  if (continuous) board.write(LPSPI + S.TCR, 7 | TCR.BYSW);
  board.tick(64);
}
function until(board, predicate) {
  for (let i = 0; i < 32 && !predicate(); i++) board.tick(1);
  assert.ok(predicate(), 'The explicit finite serial fixture reaches its phase boundary.');
}

test('absent transport retains unknown MMIO and idempotent disposal', () => {
  const board = new SPBoard();
  for (const address of [EDMA, DMAMUX + 24, LPSPI + S.CR]) {
    assert.equal(board.read(address), undefined); board.write(address, 1);
  }
  assert.equal(board.status().unknownMmio.length, 6);
  assert.equal(board.displayTransportStatus(), undefined);
  board.disposeDisplayTransport(); board.disposeDisplayTransport();
  assert.equal(board.displayTransportStatus(), undefined);
});

test('shared GPIO decoder preserves packed windows, display state and frame copies', () => {
  const published = [];
  const board = new SPBoard({onFrame(frame, count) {published.push({frame: frame.slice(), count}); frame.fill(0xee);}});
  wires(board);
  gpioBytes(board, [0x20, 0, 0x21, 3, 4, 0x22, 2, 3, 0xaf], false);
  gpioBytes(board, [0x11, 0x22, 0x33, 0x44], true);
  const expected = new Uint8Array(1024); expected.set([0x11, 0x22], 259); expected.set([0x33, 0x44], 387);
  assert.deepEqual(board.status().lastFrame, expected);
  assert.deepEqual(published, [{frame: expected, count: 1}]);
  const snapshot = board.status(); snapshot.lastFrame.fill(0xff);
  assert.deepEqual(board.status().lastFrame, expected);
  assert.equal(board.status().displayOn, true);
  gpioBytes(board, [0xae], false); assert.equal(board.status().displayOn, false);
});

test('frame predicate uses D/C at the ending edge and a completed nonempty transaction', () => {
  const board = new SPBoard(); wires(board);
  board.write(GPIO + 0x88, CS); board.write(GPIO + 0x84, DC | CLK); board.write(GPIO + 0x84, CS);
  assert.equal(board.status().frameCount, 0, 'A partial byte does not publish.');
  gpioBytes(board, [], true); assert.equal(board.status().frameCount, 0);
  board.write(GPIO + 0x88, DC | CS | CLK);
  for (let bit = 7; bit >= 0; bit--) {board.write(GPIO + 0x88, CLK | MOSI); board.write(GPIO + 0x84, CLK);}
  board.write(GPIO + 0x84, DC); board.write(GPIO + 0x84, CS);
  assert.equal(board.status().frameCount, 1, 'An instruction transaction with D/C high at the end retains the original predicate.');
});

test('GPIO SPI requires every ALT5 wire, output direction and ordinary GPIO2 bank', () => {
  for (const pin of [0, 1, 2, 3, 10]) for (const disconnect of ['mux', 'direction', 'bank']) {
    const board = new SPBoard(); wires(board);
    if (disconnect === 'mux') board.write(MUX + pin * 4, 3);
    if (disconnect === 'direction') board.write(GPIO + 4, WIRES & ~(1 << pin));
    if (disconnect === 'bank') board.write(GPR27, 1 << pin);
    gpioBytes(board, [0xff], true);
    assert.equal(board.status().frameCount, 0, `${disconnect} disconnects pin ${pin}`);
    assert.ok(board.status().lastFrame.every(byte => byte === 0));
  }
});

test('routed RESET falling resets decoder and cancels a partial GPIO transaction', () => {
  const board = new SPBoard(); wires(board);
  gpioBytes(board, [0xaf], false); gpioBytes(board, [0xff], true);
  board.write(GPIO + 0x88, RESET | CS);
  assert.equal(board.status().displayOn, false); assert.equal(board.status().frameCount, 0);
  assert.ok(board.status().lastFrame.every(byte => byte === 0));
  board.write(GPIO + 0x84, RESET | CS);
  gpioBytes(board, [0x81], true);
  assert.equal(board.status().frameCount, 1); assert.equal(board.status().lastFrame[0], 0x81);
});

test('LPSPI uses the shared decoder without changing GPIO output latches', () => {
  const board = serialBoard();
  const latch = board.read(GPIO);
  serialBytes(board, [0xaf, 0x21, 3, 4, 0x22, 2, 2], false);
  assert.equal(board.status().displayOn, true);
  serialBytes(board, [0x81, 0x42], true);
  assert.equal(board.status().frameCount, 1);
  assert.equal(board.status().lastFrame[259], 0x81); assert.equal(board.status().lastFrame[260], 0x42);
  assert.equal(board.read(GPIO) & ~DC, latch & ~DC);
  assert.equal(board.status().unknownMmio.length, 0);
});

test('ALT3 serial routing excludes GPIO collection and ALT5 excludes serial collection', () => {
  const peripheral = serialBoard(); gpioBytes(peripheral, [0xff], true);
  assert.equal(peripheral.status().frameCount, 0);
  serialBytes(peripheral, [0x81], true); assert.equal(peripheral.status().frameCount, 1);
  const gpio = serialBoard(); wires(gpio, false);
  serialBytes(gpio, [0xff], true); assert.equal(gpio.status().frameCount, 0);
  assert.equal(gpio.displayTransportStatus().lpspi.transferredWords, 1);
  gpioBytes(gpio, [0x42], true); assert.equal(gpio.status().frameCount, 1);
});

test('unrouted or reset OLED leaves serial receive work independent', () => {
  for (const blocked of ['unrouted', 'dc-input', 'dc-bank', 'reset-input', 'reset-low']) {
    const board = serialBoard();
    if (blocked === 'unrouted') board.write(MUX, 5);
    if (blocked === 'dc-input') board.write(GPIO + 4, WIRES & ~DC);
    if (blocked === 'dc-bank') board.write(GPR27, DC);
    if (blocked === 'reset-input') board.write(GPIO + 4, WIRES & ~RESET);
    if (blocked === 'reset-low') board.write(GPIO + 0x88, RESET);
    serialBytes(board, [0xff], true, false);
    assert.equal(board.status().frameCount, 0, blocked);
    assert.equal(board.displayTransportStatus().lpspi.transferredWords, 1, blocked);
    assert.equal(board.read(LPSPI + S.RDR + 3, 1), 0x5a, blocked);
  }
});

test('raw clock notifications use merged subword writes and configuration seeds', () => {
  const board = new SPBoard(); board.write(DMA_CLOCK, 0x123400c0); board.write(SPI_CLOCK, 0x567800c0);
  board.configureDisplayTransport(options());
  assert.equal(board.displayTransportStatus().clocks.dmaWord, 0x123400c0);
  assert.equal(board.displayTransportStatus().clocks.lpspiWord, 0x567800c0);
  board.write(DMA_CLOCK + 2, 0xab, 1); board.write(SPI_CLOCK + 1, 0xcd, 1);
  assert.equal(board.displayTransportStatus().clocks.dmaWord, 0x12ab00c0);
  assert.equal(board.displayTransportStatus().clocks.lpspiWord, 0x5678cdc0);
  assert.equal(board.read(DMA_CLOCK), 0x12ab00c0); assert.equal(board.read(SPI_CLOCK), 0x5678cdc0);
});

test('transport ticks with disabled or stalled GPT and status/tick0 stays passive', () => {
  for (const stalled of [false, true]) {
    const board = serialBoard(); board.faults.timerStuck = stalled;
    board.write(LPSPI + S.TCR, 7 | TCR.BYSW); board.write(LPSPI + S.TDR + 3, 0x81, 1);
    const before = board.displayTransportStatus();
    board.status(); board.read(LPSPI + S.SR); board.read(LPSPI + S.TCR); board.tick(0);
    assert.deepEqual(board.displayTransportStatus(), before);
    board.tick(64); assert.equal(board.displayTransportStatus().lpspi.transferredWords, 1);
    assert.equal(board.status().ticks, 0);
  }
});

test('write ownership routing does not probe or consume RDR', () => {
  const board = serialBoard(); serialBytes(board, [0x81], true, false);
  assert.equal(board.displayTransportStatus().lpspi.rxCount, 1);
  board.write(LPSPI + S.FCR, 0); board.write(SPI_CLOCK + 3, 0x12, 1);
  board.displayTransportStatus(); board.status();
  assert.equal(board.displayTransportStatus().lpspi.rxCount, 1);
  assert.equal(board.read(LPSPI + S.RDR + 3, 1), 0x5a);
  assert.equal(board.displayTransportStatus().lpspi.rxCount, 0);
});

test('transport IRQ follows normal Board pending state and disposal deasserts it', () => {
  const events = [], board = serialBoard(new SPBoard({onIrq: (...event) => events.push(event)}));
  board.write(LPSPI + S.IER, 1);
  assert.ok(events.some(([irq, asserted]) => irq === 35 && asserted));
  assert.ok(board.read(0xe000e204) & (1 << 3));
  board.disposeDisplayTransport();
  assert.ok(events.some(([irq, asserted]) => irq === 35 && !asserted));
  assert.equal(board.displayTransportStatus(), undefined);
});

test('reset, rebind and disposal revoke queued commands and held PCS without an old frame', () => {
  for (const action of ['reset', 'rebind', 'dispose']) {
    const board = serialBoard(); board.write(GPIO + 0x84, DC);
    board.write(LPSPI + S.TCR, 7 | TCR.BYSW | TCR.CONT); board.write(LPSPI + S.TDR + 3, 0x81, 1);
    until(board, () => board.displayTransportStatus().lpspi.heldRx);
    assert.equal(board.status().frameCount, 0);
    if (action === 'reset') board.reset();
    if (action === 'rebind') board.setMemoryCallbacks((_address, bytes) => new Uint8Array(bytes), () => {});
    if (action === 'dispose') board.disposeDisplayTransport();
    board.tick(64); assert.equal(board.status().frameCount, 0, action);
    if (action === 'dispose') assert.equal(board.displayTransportStatus(), undefined);
    else {
      const status = board.displayTransportStatus();
      assert.equal(status.lpspi.txCount, 0); assert.equal(status.lpspi.rxCount, 0);
      assert.equal(status.lpspi.heldRx, false); assert.equal(status.lpspi.pcsActive, false);
    }
  }
});

test('onFrame reset revokes the serial phase before later RX or frame publication', () => {
  let board, callbacks = 0;
  board = serialBoard(new SPBoard({onFrame() {callbacks++; board.reset();}}));
  serialBytes(board, [0x81, 0x42], true, false);
  assert.equal(callbacks, 1); assert.equal(board.status().frameCount, 0);
  const status = board.displayTransportStatus();
  assert.equal(status.lpspi.txCount, 0); assert.equal(status.lpspi.rxCount, 0);
  assert.equal(status.lpspi.transferredWords, 0);
  let irqBoard;
  irqBoard = serialBoard(new SPBoard({onIrq(irq, asserted) {if (irq === 35 && asserted) irqBoard.reset();}}));
  irqBoard.write(LPSPI + S.IER, 1);
  assert.deepEqual(irqBoard.status().unknownMmio, [], 'A cancelled register write cannot append stale unknown evidence after reset.');
  assert.equal(irqBoard.displayTransportStatus().lpspi.ier, 0);
});

test('a disposal IRQ callback replacement survives an older configure request', () => {
  let board, replace = false;
  board = serialBoard(new SPBoard({onIrq(irq, asserted) {
    if (replace && irq === 35 && !asserted) {replace = false; board.configureDisplayTransport(options(0x33));}
  }}));
  board.write(LPSPI + S.IER, 1); replace = true;
  assert.throws(() => board.configureDisplayTransport(options(0xaa)), OwnershipChanged);
  assert.equal(board.displayTransportStatus().fixtures.sinByte, 0x33);
});

test('runtime configuration overrides cannot replace Board memory or callbacks', () => {
  let calls = 0;
  const board = new SPBoard();
  board.configureDisplayTransport({...options(), memory: {read() {calls++; throw new Error('override');}, write() {calls++;}},
    onPcs() {calls++;}, onByte() {calls++;}, onIrq() {calls++;}});
  wires(board, true); board.write(DMA_CLOCK, 0xc0); board.write(SPI_CLOCK, 0xc0);
  board.write(LPSPI + S.CFGR1, 1); board.write(LPSPI + S.CR, 1);
  serialBytes(board, [0x81], true, false);
  assert.equal(calls, 0); assert.equal(board.status().frameCount, 1);
});
