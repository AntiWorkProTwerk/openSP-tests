import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SPBoard, CONTROL_NAMES, BOARD_EVIDENCE } from '../src/lib/emulator/board.ts';
import { gpioReadData, gpioReadPadStatus, gpioInputRouteEnabled, gpioMuxModeMask } from '../src/lib/emulator/gpio-read.ts';

const GPIO = 0x401bc000, GPT = 0x401ec000, ADC = 0x400c4000, UART = 0x4018c000;
function timer(board) {
  board.write(0x400fc01c, 0x40);
  board.write(0x400ac014, 0);
  board.write(GPT, 0x283);
}
function column(board, col) {
  board.write(GPIO + 0x88, (7 << 23) | (1 << 27) | (3 << 30));
  board.write(GPIO + 0x84, (col << 23) | ((col & 1) << 27) | ((col & 6) << 29));
}
function configureOledGpio(board) {
  const wires = 0x40f;
  board.write(0x400ac06c, (board.read(0x400ac06c) & ~wires) >>> 0);
  board.write(GPIO + 4, (board.read(GPIO + 4) | wires) >>> 0);
  for (const pin of [0, 1, 2, 3, 10]) board.write(0x401f813c + pin * 4, 5);
  board.write(GPIO + 0x84, 0x401);
  board.write(GPIO + 0x88, 0x0e);
}
function spi(board, bytes, pixels) {
  board.write(GPIO + (pixels ? 0x84 : 0x88), 2);
  board.write(GPIO + 0x88, 1);
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit--) {
      board.write(GPIO + 0x88, 8);
      board.write(GPIO + ((byte & (1 << bit)) ? 0x84 : 0x88), 4);
      board.write(GPIO + 0x84, 8);
    }
    board.write(GPIO + 0x88, 8);
  }
  board.write(GPIO + 0x84, 1);
}

test('source contract names original firmware, without a stock equivalence claim', () => {
  assert.match(BOARD_EVIDENCE.board, /original_r13\/board.c$/);
  const board = new SPBoard();
  assert.equal(CONTROL_NAMES.length, 55);
  assert.equal(new Set(CONTROL_NAMES).size, 55);
  assert.ok(board.status().limitations.some(text => /ADC_ETC/.test(text)));
  assert.equal(board.status().flash.fcbSource, 'geometry fixture');
});

test('oscillator MMIO and aliases advance independently of disabled GPT and reset with the board', () => {
  const board = new SPBoard({oscillator: {powerUpTicks: 2, frequencyDetectTicks: 1}});
  assert.equal(board.read(0x400d8150), 0x04000000);
  assert.equal(board.read(0x400d8270), 0x4001);
  board.tick(1);
  assert.equal(board.read(0x400d8270) & 0x10000, 0);
  board.write(0x400d8156, 1, 1); // Detector enable through the SET alias's third byte.
  assert.equal(board.read(0x400d8154), 0);
  board.tick(1);
  assert.equal(board.read(0x400d8270) & 0x10000, 0x10000);
  assert.equal(board.read(0x400d8150) & 0x8000, 0);
  board.tick(1);
  assert.equal(board.read(0x400d8150) & 0x8000, 0x8000);
  assert.equal(board.status().ticks, 0, 'GPT remains disabled while the oscillator settles.');
  assert.equal(board.status().oscillator.ticks, 3);
  assert.deepEqual(board.status().unknownMmio, []);
  board.reset();
  assert.equal(board.read(0x400d8270), 0x4001);
  assert.equal(board.read(0x400d8150), 0x04000000);
});

test('board preserves the stalled oscillator fixture and unknown neighboring register evidence', () => {
  const board = new SPBoard({timerReadTicks: 24000, oscillator: {powerUpFailure: true}});
  board.tick(100);
  assert.equal(board.read(0x400d8270) & 0x10000, 0);
  assert.equal(board.status().oscillator.configuration.powerUpFailure, true);
  board.reset(); board.tick(100);
  assert.equal(board.read(0x400d8270) & 0x10000, 0);
  assert.equal(board.read(0x400d826c), undefined);
  assert.deepEqual(board.status().unknownMmio, [{address: 0x400d826c, width: 4, operation: 'read', count: 1}]);
});

test('system registers retain unsigned E000 addresses and correct M7 identity', () => {
  const board = new SPBoard();
  assert.equal(board.read(0xe000ed00), 0x411fc271);
  assert.equal(board.read(0xe000ed14), 0x30000);
  board.write(0xe000ed08, 0x800000ff);
  assert.equal(board.read(0xe000ed08), 0x80000080);
  board.write(0xe000ef68, 0x80000000);
  assert.equal(board.read(0xe000ef68), 0x80000000);
  assert.equal(board.status().unknownMmio.length, 0);
});

test('subword NVIC priority writes preserve nearby priorities', () => {
  const board = new SPBoard();
  board.write(0xe000e414, 0x12345678);
  board.write(0xe000e416, 0x70, 1);
  assert.equal(board.read(0xe000e414), 0x12705678);
  assert.equal(board.read(0xe000e416, 1), 0x70);
  assert.equal(board.read(0xe000e416, 2), 0x1270);
});

test('NVIC ISER/ICER and pending registers implement W1S/W1C', () => {
  const board = new SPBoard();
  board.write(0xe000e100, 1 << 22);
  board.write(0xe000e100, 2);
  assert.equal(board.read(0xe000e100), (1 << 22) | 2);
  assert.equal(board.read(0xe000e180), (1 << 22) | 2);
  board.write(0xe000e180, 2);
  assert.equal(board.read(0xe000e100), 1 << 22);
  board.write(0xe000e200, (1 << 22) | 4);
  board.write(0xe000e280, 4);
  assert.equal(board.read(0xe000e200), 1 << 22);
  assert.equal(board.read(0xe000e280), 1 << 22);
});

test('GPT advances only after firmware clock selection and via explicit ticks', () => {
  const board = new SPBoard();
  board.tick(600000);
  assert.equal(board.read(GPT + 0x24), 0);
  timer(board);
  board.tick(600000);
  assert.equal(board.read(GPT + 0x24), 24000);
  assert.equal(board.read(GPT + 0x24), 24000);
  board.write(GPT + 4, 1);
  board.tick(600000);
  assert.equal(board.read(GPT + 0x24), 36000);
  board.faults.timerStuck = true;
  board.tick(600000);
  assert.equal(board.read(GPT + 0x24), 36000);
});

test('GPT reset, enable reset and modulo32 wrap are deterministic', () => {
  const board = new SPBoard({ cpuHz: 24000000 });
  timer(board);
  board.tick(0xfffffff0);
  board.tick(32);
  assert.equal(board.read(GPT + 0x24), 16);
  board.write(GPT, 0x8000);
  assert.equal(board.read(GPT), 0);
  board.write(GPT, 0x283);
  assert.equal(board.read(GPT + 0x24), 0);
});

test('optional read-driven GPT matches the retained Python functional fixture', () => {
  const board = new SPBoard({ timerReadTicks: 24000 });
  timer(board);
  board.tick(600000);
  assert.equal(board.read(GPT + 0x24), 24000);
  assert.equal(board.read(GPT + 0x24), 48000);
});

test('all40 matrix slots drive the selected active-low row and preserve OLED', () => {
  const board = new SPBoard();
  const pins = [20, 21, 22, 28, 26];
  for (let slot = 0; slot < 40; slot++) {
    column(board, Math.floor(slot / 5));
    board.setMatrix(slot, true);
    const psr = board.read(GPIO + 8);
    assert.equal((psr >>> pins[slot % 5]) & 1, 0);
    for (let row = 0; row < 5; row++) if (row !== slot % 5) assert.equal((psr >>> pins[row]) & 1, 1);
    assert.equal(psr & 1025, 1025);
    board.setMatrix(slot, false);
  }
});

test('GPIO set/clear/toggle/direct/subword writes preserve neighboring outputs under retained browser-adapter compatibility', () => {
  const board = new SPBoard();
  board.write(GPIO + 4, 0xffffffff); // Configure the existing output-only fixture explicitly.
  board.write(GPIO, 0x10203040);
  board.write(GPIO + 1, 0x55, 1);
  assert.equal(board.read(GPIO), 0x10205540);
  board.write(GPIO + 0x84, 0xf);
  assert.equal(board.read(GPIO), 0x1020554f);
  board.write(GPIO + 0x88, 3);
  assert.equal(board.read(GPIO), 0x1020554c);
  board.write(GPIO + 0x8c, 0xc);
  assert.equal(board.read(GPIO), 0x10205540);
});

test('ADC HC0 maps channels4/5/6/3 and analog mux to all32 slots', () => {
  const board = new SPBoard();
  board.write(ADC + 0x48, 0x81);
  assert.equal(board.read(ADC + 0x48), 1);
  assert.equal(board.read(ADC + 0x20), 1);
  assert.equal(board.read(ADC + 0x24), 0);
  assert.equal(board.read(ADC + 0x20), 0);
  for (let bank = 0; bank < 4; bank++) for (let col = 0; col < 8; col++) {
    const raw = bank * 1000 + col * 10;
    board.setAnalog(bank * 8 + col, raw);
    column(board, col);
    board.write(ADC, [4, 5, 6, 3][bank]);
    assert.equal(board.read(ADC + 0x20), 1);
    assert.equal(board.read(ADC + 0x24), raw);
    assert.equal(board.read(ADC + 0x20), 0);
  }
  board.write(ADC, 31);
  assert.equal(board.read(ADC + 0x20), 0);
});

test('ADC calibration and conversion faults stay observable', () => {
  const board = new SPBoard();
  board.faults.adcCalibrationFail = true;
  board.write(ADC + 0x48, 0x81);
  assert.equal(board.read(ADC + 0x48), 1);
  assert.equal(board.read(ADC + 0x4c), 2);
  assert.equal(board.read(ADC + 0x20), 0);
  board.write(ADC + 0x4c, 2);
  assert.equal(board.read(ADC + 0x4c), 0);
  board.faults.adcCalibrationStuck = true;
  board.write(ADC + 0x48, 0x81);
  assert.equal(board.read(ADC + 0x48), 0x81);
  board.faults.adcStuck = true;
  board.write(ADC, 4);
  assert.equal(board.read(ADC + 0x20), 0);
});

test('named inputs use their recorded raw path and DEL mirrors all columns', () => {
  const board = new SPBoard();
  board.setControl('DEL', 1);
  for (let col = 0; col < 8; col++) {
    column(board, col);
    assert.equal((board.read(GPIO + 8) >>> 26) & 1, 0);
  }
  board.setControl('PAD 1', 1);
  column(board, 7); board.write(ADC, 5);
  assert.equal(board.read(ADC + 0x24), 124);
  board.setControl('PAD 1', 0); board.write(ADC, 5);
  assert.equal(board.read(ADC + 0x24), 4083);
  board.setControl('VOLUME', 1);
  column(board, 0); board.write(ADC, 6);
  assert.equal(board.read(ADC + 0x24), 0);
  assert.throws(() => board.setControl('GAIN', 1), /Unmapped control/);
});

test('UART FIFO, errors, exact SHIFT bytes and IRQ22 follow the firmware path', () => {
  const lines = [];
  const board = new SPBoard({ onIrq: (irq, asserted) => { lines.push([irq, asserted]); } });
  board.write(UART + 0x18, 0x0f2c0000);
  board.setControl('SHIFT', 1);
  assert.deepEqual(lines.at(-1), [22, true]);
  assert.equal(board.read(UART + 0x14), 0xe00000);
  assert.deepEqual(Array.from({ length: 4 }, () => board.read(UART + 0x1c)), [1, 255, 255, 1]);
  assert.deepEqual(lines.at(-1), [22, false]);
  assert.equal(board.read(UART + 0x14), 0xc00000);
  board.injectUart([0x89], 0x20000);
  assert.equal(board.read(UART + 0x14) & 0xf0000, 0x20000);
  board.write(UART + 0x14, 0x20000);
  board.write(UART + 0x28, 0x4088);
  assert.equal(board.read(UART + 0x14), 0xc00000);
  board.faults.uartTxStuck = true;
  assert.equal(board.read(UART + 0x14), 0);
});

test('companion fixture replies to startup and removes modeled power only on shutdown ACK', () => {
  const board = new SPBoard();
  for (const byte of [1, 255, 0, 1]) board.write(UART + 0x1c, byte);
  assert.deepEqual(Array.from({ length: 4 }, () => board.read(UART + 0x1c)), [1, 255, 0, 16]);
  board.requestPowerOff();
  assert.deepEqual(Array.from({ length: 4 }, () => board.read(UART + 0x1c)), [1, 255, 0, 1]);
  assert.equal(board.status().powered, true);
  for (const byte of [1, 255, 0, 0]) board.write(UART + 0x1c, byte);
  assert.equal(board.status().powered, false);
  assert.deepEqual(board.takeUartTx(), Uint8Array.from([1, 255, 0, 1, 1, 255, 0, 0]));
});

test('encoder levels remain separate from matrix row pins', () => {
  const board = new SPBoard();
  for (let state = 0; state < 4; state++) {
    board.setEncoderState(state);
    assert.equal((board.read(GPIO + 8) >>> 18) & 3, state);
    assert.equal((board.read(GPIO + 8) >>> 20) & 7, 7);
  }
});

test('GPIO SPI produces exact page-packed OLED bytes from transfer writes', () => {
  const frames = [];
  const board = new SPBoard({ onFrame: (frame, count) => { frames.push({ frame, count }); } });
  configureOledGpio(board);
  spi(board, [0x20, 0, 0x21, 0, 127, 0x22, 0, 7, 0xaf], false);
  const bytes = Uint8Array.from({ length: 1024 }, (_, i) => (i * 7) & 255);
  spi(board, bytes, true);
  assert.equal(board.status().displayOn, true);
  assert.equal(board.status().frameCount, 1);
  assert.deepEqual(board.status().lastFrame, bytes);
  assert.deepEqual(frames, [{ frame: bytes, count: 1 }]);
  spi(board, [0xae], false);
  assert.equal(board.status().displayOn, false);
});

test('OLED partial horizontal-window data updates only addressed RAM', () => {
  const board = new SPBoard();
  configureOledGpio(board);
  spi(board, [0x21, 3, 4, 0x22, 2, 3], false);
  spi(board, [0x11, 0x22, 0x33, 0x44], true);
  const expected = new Uint8Array(1024);
  expected.set([0x11, 0x22], 2 * 128 + 3);
  expected.set([0x33, 0x44], 3 * 128 + 3);
  assert.deepEqual(board.status().lastFrame, expected);
});

const SAI = 0x40384000;
function startSaiRx(board, {watermark = 0, continueOnError = true} = {}) {
  // R14/R15 register sequence, without an external-clock or physical-route claim.
  board.write(SAI + 0x88, 0x03000000); board.write(SAI + 0x88, 0);
  board.write(SAI + 0x8c, watermark); board.write(SAI + 0x90, 0);
  board.write(SAI + 0x94, 0x10000);
  board.write(SAI + 0x98, continueOnError ? 0x100f1f10 : 0x000f1f10);
  board.write(SAI + 0x9c, 0x1f1f0f00); board.write(SAI + 0xe0, 0);
  board.write(SAI + 0x88, 0x90000000);
}
const rxPointers = board => {
  const fifo = board.read(SAI + 0xc0);
  return {read: fifo & 63, write: fifo >>> 16 & 63};
};

test('SAI injected FIFO pointers, overflow clear and collected TX writes are observable', () => {
  const board = new SPBoard();
  startSaiRx(board);
  board.injectAudioRx([0x12345678, 0xffffffff]);
  assert.equal(board.read(0x403840c0), 0x20000);
  assert.equal(board.read(0x403840a0), 0x12345678);
  assert.equal(board.read(0x403840c0), 0x20001);
  assert.equal(board.read(0x403840a0), 0xffffffff);
  assert.equal(board.read(0x403840c0), 0x20002);
  board.injectAudioRx(new Uint32Array(33));
  assert.equal(board.read(0x40384088) & 0x40000, 0x40000);
  board.write(0x40384088, 0x90040000);
  assert.equal(board.read(0x40384088) & 0x40000, 0);
  board.write(0x40384020, 0x76543210);
  assert.deepEqual(board.takeAudioTx(), Uint32Array.from([0x76543210]));
});

test('SAI receiver/channel gates affect injection while existing FIFO data can still be drained', () => {
  const board = new SPBoard();
  assert.equal(board.injectAudioRx([1]), 0);
  board.write(SAI + 0x88, 0x80000000);
  assert.equal(board.read(SAI + 0x88), 0x90000000, 'RE automatically sets BCE');
  assert.equal(board.injectAudioRx([1]), 0, 'RCE0 is still disabled');
  board.write(SAI + 0x94, 0x10000);
  assert.equal(board.injectAudioRx([1, 2]), 2);
  assert.equal(board.read(SAI + 0x88) & 0x10000, 0x10000);
  board.write(SAI + 0x94, 0);
  assert.equal(board.read(SAI + 0x88) & 0x30000, 0, 'disabled channel has no request/full flag');
  assert.equal(board.injectAudioRx([3]), 0);
  assert.equal(board.read(SAI + 0xa0), 1, 'software can drain a disabled channel');
  board.write(SAI + 0x94, 0x10000); board.write(SAI + 0x88, 0);
  assert.equal(board.injectAudioRx([4]), 0);
  assert.equal(board.read(SAI + 0xa0), 2, 'software can drain a disabled receiver');
  assert.deepEqual(rxPointers(board), {read: 2, write: 2});
});

test('SAI RX request uses count greater than watermark and warning uses exactly32 enabled entries', () => {
  for (const watermark of [0, 16, 31]) {
    const board = new SPBoard(); startSaiRx(board, {watermark});
    assert.equal(board.read(SAI + 0x88) & 0x30000, 0);
    assert.equal(board.injectAudioRx(Array.from({length: watermark}, (_, index) => index)), watermark);
    assert.equal(board.read(SAI + 0x88) & 0x30000, 0);
    board.injectAudioRx([100]);
    assert.equal(board.read(SAI + 0x88) & 0x10000, 0x10000);
    assert.equal(board.read(SAI + 0x88) & 0x20000, watermark === 31 ? 0x20000 : 0);
    board.read(SAI + 0xa0);
    assert.equal(board.read(SAI + 0x88) & 0x30000, 0);
  }
  const board = new SPBoard(); startSaiRx(board, {watermark: 16});
  board.injectAudioRx(new Uint32Array(32));
  const pointers = rxPointers(board);
  assert.equal(pointers.read ^ pointers.write, 32, 'MSB distinguishes full from empty');
  board.write(SAI + 0x88, 0x90030000);
  assert.equal(board.read(SAI + 0x88) & 0x30000, 0x30000, 'RO flags cannot be cleared by writes');
  board.write(SAI + 0x8c, 0xffffffff);
  assert.equal(board.read(SAI + 0x8c), 31, 'RFW is five bits');
  board.read(SAI + 0xa0);
  assert.equal(board.read(SAI + 0x88) & 0x30000, 0, '31 entries is at the highest watermark');
});

test('SAI RX pointers wrap modulo64 across repeated full FIFO and retain exact word order', () => {
  const board = new SPBoard(); startSaiRx(board);
  for (let block = 0; block < 5; block++) {
    const words = Array.from({length: 32}, (_, index) => block * 32 + index + 1);
    assert.equal(board.injectAudioRx(words), 32);
    const full = rxPointers(board); assert.equal(full.read ^ full.write, 32);
    assert.deepEqual(words.map(() => board.read(SAI + 0xa0)), words);
    assert.deepEqual(rxPointers(board), {read: (block + 1) * 32 & 63, write: (block + 1) * 32 & 63});
    board.read(SAI + 0xa0);
    assert.deepEqual(rxPointers(board), {read: (block + 1) * 32 & 63, write: (block + 1) * 32 & 63});
  }
});

test('SAI RX FIFO reset preserves nonzero write phase and sticky flags; software reset is held', () => {
  const board = new SPBoard(); startSaiRx(board, {watermark: 16});
  board.injectAudioRx([1, 2, 3, 4, 5]); board.read(SAI + 0xa0);
  board.injectAudioRx(new Uint32Array(33), {wordStart: true, syncError: true});
  const before = rxPointers(board);
  assert.notEqual(before.write, 0); assert.equal(board.read(SAI + 0x88) & 0x1c0000, 0x1c0000);
  board.write(SAI + 0x88, 0x92000000);
  assert.deepEqual(rxPointers(board), {read: before.write, write: before.write});
  assert.equal(board.read(SAI + 0x88) & 0x02000000, 0, 'FR reads zero');
  assert.equal(board.read(SAI + 0x88) & 0x1c0000, 0x1c0000, 'FR preserves all sticky flags');
  assert.equal(board.read(SAI + 0x88) & 0x30000, 0);
  board.write(SAI + 0x88, 0x911c0000);
  assert.equal(board.read(SAI + 0x88), 0x91000000, 'SR is held, not self-clearing');
  assert.deepEqual(rxPointers(board), {read: 0, write: 0});
  assert.equal(board.read(SAI + 0x8c), 16); assert.equal(board.read(SAI + 0x94), 0x10000);
  assert.equal(board.read(SAI + 0x98), 0x100f1f10, 'configuration survives SR');
  assert.equal(board.injectAudioRx([9], {wordStart: true, syncError: true}), 0);
  assert.equal(board.read(SAI + 0x88), 0x91000000);
  board.write(SAI + 0x88, 0x90000000);
  assert.equal(board.injectAudioRx([9]), 1); assert.equal(board.read(SAI + 0xa0), 9);
});

test('SAI RX W1C writes honor byte lanes and selected-word/sync events remain sticky across reads', () => {
  const board = new SPBoard(); startSaiRx(board);
  board.injectAudioRx(new Uint32Array(33), {wordStart: true, syncError: true});
  assert.equal(board.read(SAI + 0x88) & 0x1c0000, 0x1c0000);
  const pointers = rxPointers(board);
  board.write(SAI + 0x88, 0x02040000, 1);
  assert.equal(board.read(SAI + 0x88) & 0x1c0000, 0x1c0000, 'unwritten high bits cannot clear FEF');
  assert.deepEqual(rxPointers(board), pointers, 'unwritten high bits cannot trigger FR');
  board.write(SAI + 0x94, 0x01030000, 1);
  assert.equal(board.read(SAI + 0x94), 0x10000, 'unwritten channel/reset bits cannot change RCR3');
  assert.deepEqual(board.status().unknownMmio, []);
  board.write(SAI + 0x88, 0, 1);
  assert.equal(board.read(SAI + 0x88) & 0x1c0000, 0x1c0000, 'low-byte write does not clear high-byte flags');
  board.write(SAI + 0x8a, 4, 1);
  assert.equal(board.read(SAI + 0x88) & 0x1c0000, 0x180000);
  board.write(SAI + 0x8a, 8, 1);
  assert.equal(board.read(SAI + 0x88) & 0x1c0000, 0x100000);
  board.write(SAI + 0x8a, 16, 1);
  assert.equal(board.read(SAI + 0x88) & 0x1c0000, 0);
  assert.equal((board.read(SAI + 0x88) & 0x90000000) >>> 0, 0x90000000);
  board.write(SAI + 0x88, 0x90000000);
  assert.equal(board.read(SAI + 0x88) & 0x1c0000, 0, 'writing one to an unset W1C flag never sets it');
});

test('SAI RX narrow reads each consume one unpacked entry; empty and RO writes preserve pointers', () => {
  const board = new SPBoard(); startSaiRx(board);
  board.injectAudioRx([0x12345678, 0x89abcdef, 0xfedcba98]);
  assert.equal(board.read(SAI + 0xa0, 1), 0x78);
  assert.equal(board.read(SAI + 0xa0, 2), 0xcdef);
  assert.equal(board.read(SAI + 0xa0, 4), 0xfedcba98);
  assert.deepEqual(rxPointers(board), {read: 3, write: 3});
  board.write(SAI + 0xc0, 0xffffffff); board.write(SAI + 0xa0, 0xffffffff);
  board.read(SAI + 0xa0, 1); board.read(SAI + 0xa0, 2); board.read(SAI + 0xa0, 4);
  assert.deepEqual(rxPointers(board), {read: 3, write: 3});
  assert.deepEqual(board.status().unknownMmio, []);
});

test('SAI RX overflow preserves queued words; FCONT1 permits explicit continuation despite stickyFEF', () => {
  const board = new SPBoard(); startSaiRx(board);
  const words = Array.from({length: 33}, (_, index) => index + 1);
  assert.equal(board.injectAudioRx(words), 32);
  assert.deepEqual(rxPointers(board), {read: 0, write: 32});
  assert.equal(board.read(SAI + 0x88) & 0x40000, 0x40000);
  assert.equal(board.read(SAI + 0xa0), 1);
  assert.equal(board.injectAudioRx([33]), 1, 'caller retries continuation when space exists');
  assert.deepEqual(words.slice(1).map(() => board.read(SAI + 0xa0)), words.slice(1));
  assert.equal(board.read(SAI + 0x88) & 0x40000, 0x40000);
});

test('SAI RX FCONT0 discards injected continuation until FEF clears and a new explicit frame begins', () => {
  const board = new SPBoard(); startSaiRx(board, {continueOnError: false});
  board.injectAudioRx(new Uint32Array(33));
  board.write(SAI + 0x88, 0x92000000);
  assert.equal(board.injectAudioRx([1], {frameStart: true}), 0, 'FEF remains set after FR');
  board.write(SAI + 0x88, 0x90040000);
  assert.equal(board.injectAudioRx([1]), 0, 'a new frame has not started');
  assert.equal(board.injectAudioRx([2], {frameStart: true}), 1);
  assert.equal(board.read(SAI + 0xa0), 2);
});

test('SAI RX flags drive their matching IRQ56 enables and requests fall when occupancy drops', () => {
  const lines = []; const board = new SPBoard({onIrq: (irq, asserted) => {if (irq === 56) lines.push(asserted);}});
  startSaiRx(board, {watermark: 16}); board.write(SAI + 0x88, 0x90000100);
  board.injectAudioRx(new Uint32Array(16)); assert.equal(lines.at(-1), false);
  board.injectAudioRx([17]); assert.equal(lines.at(-1), true);
  board.read(SAI + 0xa0); assert.equal(lines.at(-1), false);
  board.write(SAI + 0x88, 0x90001000);
  board.injectAudioRx([], {syncError: true}); assert.equal(lines.at(-1), false, 'SEF cannot trigger WSIE');
  board.injectAudioRx([], {wordStart: true}); assert.equal(lines.at(-1), true);
  board.write(SAI + 0x8a, 16, 1); assert.equal(lines.at(-1), false, 'W1C drops word-start IRQ without clearing SEF');
  board.write(SAI + 0x88, 0x90000800); assert.equal(lines.at(-1), true, 'enabling SEIE observes the existing SEF');
  board.write(SAI + 0x88, 0x91000800); assert.equal(lines.at(-1), false, 'SR clears status and IRQ');
});

test('SAI additional channels, packing, combine, masks, DMA and individual FIFO reset remain visible as unsupported', () => {
  for (const [offset, value] of [[0x94, 0x30000], [0x94, 0x01010000], [0x98, 0x120f1f10],
    [0x98, 0x140f1f10], [0xe0, 1], [0x88, 0x90000001]]) {
    const board = new SPBoard(); startSaiRx(board);
    board.write(SAI + offset, value);
    assert.deepEqual(board.status().unknownMmio, [{address: SAI + offset, width: 4, operation: 'write', count: 1}]);
    if ((offset !== 0x94 || value !== 0x01010000) && offset !== 0x88) assert.equal(board.injectAudioRx([1]), 0);
    if (offset === 0x94 && value === 0x01010000) assert.equal(board.read(SAI + offset), 0x10000, 'CFR reads zero despite unimplemented reset');
  }
  const board = new SPBoard();
  assert.equal(board.read(SAI + 0xa4), undefined); assert.equal(board.read(SAI + 0xc4), undefined);
  assert.equal(board.status().unknownMmio.length, 2);
});

test('unknown MMIO remains undefined and carries operation/address/count', () => {
  const board = new SPBoard();
  assert.equal(board.read(0x403b0028), undefined);
  assert.equal(board.read(0x403b0028), undefined);
  board.write(0x403b0000, 1);
  assert.deepEqual(board.status().unknownMmio, [
    { address: 0x403b0028, width: 4, operation: 'read', count: 2 },
    { address: 0x403b0000, width: 4, operation: 'write', count: 1 },
  ]);
  assert.throws(() => board.read(GPIO + 1), /aligned/);
  assert.throws(() => board.setAnalog(32, 0), /Slot/);
  assert.throws(() => board.setAnalog(0, 4096), /ADC/);
  assert.throws(() => board.tick(-1), /nonnegative/);
});

test('reset clears volatile board inputs/display and preserves NOR bytes', () => {
  const board = new SPBoard();
  configureOledGpio(board);
  board.flash.flash[0x80000] = 0x12;
  board.setControl('SHIFT', 1);
  board.setMatrix(0, true);
  spi(board, [0xaf], false);
  spi(board, [1], true);
  board.read(0x403b0028);
  board.reset();
  assert.equal(board.flash.flash[0x80000], 0x12);
  assert.equal(board.status().frameCount, 0);
  assert.equal(board.status().displayOn, false);
  assert.equal(board.status().uartRxBytes, 0);
  assert.equal(board.status().unknownMmio.length, 0);
  column(board, 0);
  assert.equal((board.read(GPIO + 8) >>> 20) & 1, 1);
});

const GPIO1 = 0x401b8000, MUX1 = 0x401f80bc, MUX2 = 0x401f813c;
const GPR26 = 0x400ac068, GPR27 = 0x400ac06c;

test('generic DR selection covers all32 bits independently of the output latch', () => {
  const latch = 0x89abcdef, samples = 0x76543210, direction = 0xa5a55a5a, routes = 0xf0ff0ff0;
  let expected = 0;
  for (let bit = 0; bit < 32; bit++) {
    const value = (direction >>> bit) & 1 ? (latch >>> bit) & 1
      : ((samples >>> bit) & 1) & ((routes >>> bit) & 1);
    expected += value * 2 ** bit;
  }
  assert.equal(gpioReadData(latch, direction, samples, routes), expected);
  assert.equal(gpioReadData(0xffffffff, 0xffffffff, 0, 0), 0xffffffff);
  assert.equal(gpioReadData(0xffffffff, 0, 0, 0xffffffff), 0);
  assert.equal(gpioReadPadStatus(samples, routes), 0x70540210);
});

test('GPIO ALT5 and ordinary bank selection are required for a routed input', () => {
  for (let mode = 0; mode < 8; mode++) {
    assert.equal(gpioInputRouteEnabled(mode, 7, false), mode === 5);
    assert.equal(gpioInputRouteEnabled(mode | 0x10, 7, false), mode === 5, 'SION does not change the selected GPIO function');
    assert.equal(gpioInputRouteEnabled(mode, 7, true), false);
  }
});

test('stock source setup reads the existing ready fixture through DR and PSR', () => {
  const board = new SPBoard();
  board.write(GPR26, board.read(GPR26) & ~1);
  board.write(MUX1, 5);
  board.write(GPIO1 + 4, board.read(GPIO1 + 4) & ~1);
  assert.equal(board.read(GPIO1) & 1, 1);
  assert.equal(board.read(GPIO1 + 8) & 1, 1);
  board.setReadyPin(false);
  assert.equal(board.read(GPIO1) & 1, 0);
  assert.equal(board.read(GPIO1 + 8) & 1, 0);
  board.setReadyPin(true);
  assert.equal(board.read(GPIO1) & 1, 1);
});

test('input DR writes retain a latent latch and never force the sampled ready level', () => {
  const board = new SPBoard(); board.setReadyPin(false);
  board.write(GPIO1 + 0x84, 1);
  assert.equal(board.read(GPIO1) & 1, 0);
  board.write(GPIO1 + 4, 1);
  assert.equal(board.read(GPIO1) & 1, 1);
  assert.equal(board.read(GPIO1 + 8) & 1, 0, 'PSR keeps the supplied sample instead of the output latch');
  board.write(GPIO1 + 4, 0); board.setReadyPin(true);
  board.write(GPIO1 + 0x88, 1);
  assert.equal(board.read(GPIO1) & 1, 1);
  board.write(GPIO1 + 4, 1);
  assert.equal(board.read(GPIO1) & 1, 0);
  assert.equal(board.read(GPIO1 + 8) & 1, 1);
});

test('non-GPIO input mux reads zero while output DR still returns its stored latch', () => {
  const board = new SPBoard(); board.write(GPIO1 + 0x84, 1);
  for (const mux of [0, 1, 2, 3, 4, 6, 7, 0x10]) {
    board.write(MUX1, mux);
    assert.equal(board.read(GPIO1) & 1, 0);
    assert.equal(board.read(GPIO1 + 8) & 1, 0);
    board.write(GPIO1 + 4, 1);
    assert.equal(board.read(GPIO1) & 1, 1);
    board.write(GPIO1 + 4, 0);
  }
  board.write(MUX1, 0x15);
  assert.equal(board.read(GPIO1) & 1, 1);
});

test('GPIO1/6 and GPIO2/7 selection masks only the corresponding input routes', () => {
  const board = new SPBoard();
  board.write(GPR26, 1);
  assert.equal(board.read(GPIO1) & 1, 0);
  assert.equal(board.read(GPIO1 + 8) & 1, 0);
  board.write(GPIO1 + 0x84, 1); board.write(GPIO1 + 4, 1);
  assert.equal(board.read(GPIO1) & 1, 1, 'output-latch reads remain local to GPIO1');
  board.write(GPIO1 + 4, 0); board.write(GPR26, 0);
  assert.equal(board.read(GPIO1) & 1, 1);
  board.write(GPR27, 1 << 20);
  assert.equal(board.read(GPIO) & (1 << 20), 0);
  assert.equal(board.read(GPIO + 8) & (1 << 21), 1 << 21);
  board.write(GPR27, 0);
  assert.equal(board.read(GPIO) & (1 << 20), 1 << 20);
});

test('GPIO matrix DR input reads match all40 original active-low slot samples', () => {
  const board = new SPBoard();
  board.write(GPIO + 4, 7 << 23); // Drive column selectors, sample row inputs.
  const pins = [20, 21, 22, 28, 26];
  for (let slot = 0; slot < 40; slot++) {
    column(board, Math.floor(slot / 5)); board.setMatrix(slot, true);
    const dr = board.read(GPIO), psr = board.read(GPIO + 8);
    for (let row = 0; row < 5; row++) {
      assert.equal((dr >>> pins[row]) & 1, row === slot % 5 ? 0 : 1);
      assert.equal((dr >>> pins[row]) & 1, (psr >>> pins[row]) & 1);
    }
    assert.equal((dr >>> 23) & 7, Math.floor(slot / 5));
    board.setMatrix(slot, false);
  }
});

test('encoder DR samples stay independent of stored latch bits and direction changes', () => {
  const board = new SPBoard(); board.write(GPIO, 3 << 18);
  for (let state = 0; state < 4; state++) {
    board.setEncoderState(state);
    assert.equal((board.read(GPIO) >>> 18) & 3, state);
    assert.equal((board.read(GPIO + 8) >>> 18) & 3, state);
  }
  board.write(GPIO + 4, 3 << 18); board.setEncoderState(0);
  assert.equal((board.read(GPIO) >>> 18) & 3, 3);
  assert.equal((board.read(GPIO + 8) >>> 18) & 3, 0);
});

test('mux and bank-select narrow writes preserve retained browser-adapter compatibility', () => {
  const board = new SPBoard();
  board.write(MUX1, 0, 1); assert.equal(board.read(GPIO1) & 1, 0);
  board.write(MUX1, 5, 1); assert.equal(board.read(GPIO1) & 1, 1);
  board.write(MUX1 + 1, 0xab, 1);
  assert.equal(board.read(MUX1), 0xab05);
  assert.equal(board.read(GPIO1) & 1, 1);
  board.write(GPR27 + 2, 0x10, 1);
  assert.equal(board.read(GPIO) & (1 << 20), 0);
  assert.equal(board.read(GPIO) & (1 << 21), 1 << 21);
  board.write(GPR27 + 2, 0, 1);
  assert.equal(board.read(GPIO) & (1 << 20), 1 << 20);
});

test('narrow DR reads retain browser-adapter compatibility after digital source selection', () => {
  const board = new SPBoard(); board.write(GPIO1 + 4, 0xffffffff); board.write(GPIO1, 0x89abcdef);
  board.setReadyPin(false); board.write(GPIO1 + 4, 0xfffffffe);
  assert.equal(board.read(GPIO1), 0x89abcdee);
  assert.equal(board.read(GPIO1, 1), 0xee);
  assert.equal(board.read(GPIO1 + 1, 1), 0xcd);
  assert.equal(board.read(GPIO1 + 2, 2), 0x89ab);
  board.setReadyPin(true); assert.equal(board.read(GPIO1, 1), 0xef);
});

test('each bank preserves bit31 routing and unsigned output reads', () => {
  const board = new SPBoard();
  for (const [base, muxBase, gpr] of [[GPIO1, MUX1, GPR26], [GPIO, MUX2, GPR27]]) {
    board.write(base + 0x84, 0x80000000);
    assert.equal(board.read(base) >>> 31, 1);
    board.write(muxBase + 31 * 4, 0);
    assert.equal(board.read(base) >>> 31, 0);
    board.write(base + 4, 0x80000000);
    assert.equal(board.read(base) >>> 31, 1);
    board.write(base + 4, 0); board.write(muxBase + 31 * 4, 5); board.write(gpr, 0x80000000);
    assert.equal(board.read(base) >>> 31, 0);
    board.write(gpr, 0); assert.equal(board.read(base) >>> 31, 1);
  }
});

test('reset restores primary mux defaults, input directions and the existing high-ready fixture', () => {
  const board = new SPBoard(); board.write(MUX1, 0); board.write(GPR26, 1);
  board.write(GPIO1 + 4, 0xffffffff); board.setReadyPin(false); board.reset();
  for (let pin = 0; pin < 64; pin++)
    assert.equal(board.read(MUX1 + pin * 4), pin >= 4 && pin <= 11 ? 0 : 5);
  assert.equal(board.read(GPIO1 + 4), 0); assert.equal(board.read(GPIO + 4), 0);
  assert.equal(board.read(GPR26), 0); assert.equal(board.read(GPR27), 0);
  assert.equal(board.read(GPIO1) & 1, 1);
  board.write(GPIO1 + 4, 1);
  assert.equal(board.read(GPIO1) & 1, 0, 'reset leaves the output latch clear');
  assert.deepEqual(board.status().unknownMmio, []);
});

const muxFields = JSON.parse(readFileSync(new URL('./fixtures/gpio12-mux-fields.json', import.meta.url), 'utf8'));

test('all64 per-pad masks match the retained primary field-layout bindings', () => {
  assert.equal(muxFields.pads.length, 64);
  assert.equal(muxFields.pads.filter(pad => pad.muxModeMask === 7).length, 11);
  assert.equal(muxFields.pads.filter(pad => pad.muxModeMask === 15).length, 53);
  for (const pad of muxFields.pads) {
    assert.equal(gpioMuxModeMask(pad.bank, pad.pin), pad.muxModeMask, pad.pad);
    assert.equal(Number(pad.muxAddress), (pad.bank === 1 ? MUX1 : MUX2) + pad.pin * 4);
    assert.equal(pad.fieldBits, pad.bit3Reserved ? '2:0' : '3:0');
    assert.ok(pad.manualPrintedStartPage >= 468 && pad.manualPrintedStartPage <= 535);
    assert.ok(pad.headerLine > 0);
  }
});

test('finite mux selection covers all16 field values and SION for each primary pad layout', () => {
  for (const pad of muxFields.pads) {
    for (let mode = 0; mode < 16; mode++) {
      const expected = pad.bit3Reserved ? mode === 5 || mode === 13 : mode === 5;
      for (const sion of [0, 0x10]) {
        assert.equal(gpioInputRouteEnabled(mode | sion, gpioMuxModeMask(pad.bank, pad.pin), false), expected, `${pad.pad} mode${mode}`);
        assert.equal(gpioInputRouteEnabled(mode | sion, gpioMuxModeMask(pad.bank, pad.pin), true), false);
      }
    }
  }
});

test('all64 mapped GPIO inputs apply the actual per-pad field width through board configuration writes', () => {
  const board = new SPBoard();
  board.write(GPIO1, 0xffffffff); board.write(GPIO, 0xffffffff); board.setEncoderState(3);
  board.write(GPIO1 + 4, 0); board.write(GPIO + 4, 0);
  for (const pad of muxFields.pads) {
    const base = pad.bank === 1 ? GPIO1 : GPIO;
    const address = Number(pad.muxAddress);
    for (let mode = 0; mode < 16; mode++) {
      const expected = pad.bit3Reserved ? Number(mode === 5 || mode === 13) : Number(mode === 5);
      for (const sion of [0, 0x10]) {
        board.write(address, mode | sion);
        assert.equal((board.read(base) >>> pad.pin) & 1, expected, `${pad.pad} DR mode${mode}`);
        assert.equal((board.read(base + 8) >>> pad.pin) & 1, expected, `${pad.pad} PSR mode${mode}`);
      }
    }
    board.write(address, 5);
  }
});

test('ALT13 never aliases GPIO ALT5 on wide fields; three-bit pads ignore their reserved bit3', () => {
  const board = new SPBoard();
  board.write(GPIO1, 0xffffffff); board.write(GPIO, 0xffffffff); board.setEncoderState(3);
  for (const pad of muxFields.pads) {
    const base = pad.bank === 1 ? GPIO1 : GPIO;
    board.write(Number(pad.muxAddress), 13);
    assert.equal((board.read(base) >>> pad.pin) & 1, Number(pad.bit3Reserved), pad.pad);
    board.write(base + 4, 0xffffffff);
    assert.equal((board.read(base) >>> pad.pin) & 1, 1, 'the output latch survives an inactive input route');
    board.write(base + 4, 0);
    board.write(Number(pad.muxAddress), 5);
  }
});

test('per-pad mask lookup rejects out-of-scope banks and pins without changing board state', () => {
  for (const [bank, pin] of [[0, 0], [3, 0], [1, -1], [2, 32], [1, 0.5]])
    assert.throws(() => gpioMuxModeMask(bank, pin), /bank1\/2 and pin0\.\.31/);
  assert.equal(gpioMuxModeMask(1, 0), 7);
  assert.equal(gpioMuxModeMask(1, 9), 15);
  assert.equal(gpioMuxModeMask(1, 12), 7);
  assert.equal(gpioMuxModeMask(2, 0), 15);
});
