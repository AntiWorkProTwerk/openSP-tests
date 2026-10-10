import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Rt1062AudioPll, PLL_AUDIO_REG as R, PLL_AUDIO_BITS as B,
  PLL_AUDIO_RESET, PLL_AUDIO_NUM_RESET, PLL_AUDIO_DENOM_RESET, PLL_AUDIO_WRITABLE,
} from '../src/lib/emulator/pll-audio.ts';

function configure(pll, divider = 36, source = 0) {
  pll.write(R.CONTROL, (pll.read(R.CONTROL) & ~(0x7f | 0xc000 | 0x1000)) | divider | (source << 14));
}
function ready(options) {
  const pll = new Rt1062AudioPll(options);
  configure(pll);
  pll.tick(pll.status().configuration.lockTicks);
  assert.equal(pll.status().locked, true);
  return pll;
}
function fraction(pll, numerator, denominator) {
  pll.write(R.NUM, numerator);
  pll.write(R.DENOM, denominator);
}

// CLOCK_InitAudioPll, pinned NXP SDK lines 722..792:
// https://github.com/nxp-mcuxpresso/legacy-mcux-sdk/blob/6f3fd257cdcf978a4d26e7d6e9eed9240037422b/devices/MIMXRT1062/drivers/fsl_clock.c#L722-L792
// The finite caller advances explicit ticks once in place of the unbounded poll.
function sdkInitialize(pll, config, misc2Initial = 0xfadada5a) {
  const MISC2 = 0x400d8170;
  let externalMisc2 = misc2Initial >>> 0;
  const writes = [];
  function read(address) {
    return address === MISC2 ? externalMisc2 : pll.read(address);
  }
  function write(address, value) {
    const before = pll.status();
    const handled = pll.write(address, value);
    writes.push({ address, value: value >>> 0, handled });
    if (address === MISC2) {
      assert.equal(handled, false);
      assert.deepEqual(pll.status(), before);
      externalMisc2 = value >>> 0;
    } else assert.equal(handled, true);
  }
  write(R.CONTROL, (read(R.CONTROL) & ~0xc000) | 0x10000 | ((config.src << 14) & 0xc000));
  write(R.NUM, config.numerator & 0x3fffffff);
  write(R.DENOM, config.denominator & 0x3fffffff);
  let pllAudio = (read(R.CONTROL) & ~(0x7f | 0x1000)) | 0x2000 | (config.loopDivider & 0x7f);
  let misc2 = 0;
  switch (config.postDivider) {
    case 16: pllAudio |= 0 << 19; misc2 = 0x800000 | 0x8000; break;
    case 8: pllAudio |= 1 << 19; misc2 = 0x800000 | 0x8000; break;
    case 4: pllAudio |= 2 << 19; misc2 = 0x800000 | 0x8000; break;
    case 2: pllAudio |= 1 << 19; break;
    default: pllAudio |= 2 << 19; break;
  }
  write(MISC2, (read(MISC2) & ~(0x8000 | 0x800000)) | misc2);
  write(R.CONTROL, pllAudio);
  const polling = pll.status();
  assert.equal(read(R.CONTROL) & 0x80000000, 0);
  assert.equal(polling.bypassed, true);
  pll.tick(pll.status().configuration.lockTicks);
  assert.notEqual(read(R.CONTROL) & 0x80000000, 0);
  write(R.CONTROL, read(R.CONTROL) & ~0x10000);
  return { writes, polling, externalMisc2 };
}

test('primary addresses masks and literal reset words match the NXP AUDIO contract', () => {
  assert.deepEqual(R, { CONTROL: 0x400d8070, SET: 0x400d8074, CLR: 0x400d8078,
    TOG: 0x400d807c, NUM: 0x400d8080, DENOM: 0x400d8090 });
  assert.deepEqual(B, { DIV_SELECT: 0x7f, POWERDOWN: 0x1000, ENABLE: 0x2000,
    BYPASS_CLK_SRC: 0xc000, BYPASS: 0x10000, POST_DIV_SELECT: 0x180000, LOCK: 0x80000000 });
  assert.equal(PLL_AUDIO_RESET, 0x11006);
  assert.equal(PLL_AUDIO_NUM_RESET, 0x05f5e100);
  assert.equal(PLL_AUDIO_DENOM_RESET, 0x2964619c);
  assert.equal(PLL_AUDIO_WRITABLE, 0x19f07f);
});

test('reset keeps the literal invalid divider powered down with valid fractional defaults', () => {
  const pll = new Rt1062AudioPll();
  assert.equal(pll.read(R.CONTROL), 0x11006);
  assert.equal(pll.read(R.NUM), 0x05f5e100);
  assert.equal(pll.read(R.DENOM), 0x2964619c);
  const s = pll.status();
  assert.equal(s.divider, 6);
  assert.equal(s.poweredDown, true);
  assert.equal(s.bypassed, true);
  assert.equal(s.outputEnabled, false);
  assert.equal(s.numerator, 100000000);
  assert.equal(s.signedNumerator, 100000000);
  assert.equal(s.denominator, 0x2964619c);
  assert.equal(s.fractionalValid, true);
  assert.equal(s.postDividerCode, 0);
  assert.equal(s.postDivider, 4);
  pll.tick(0xffffffff);
  assert.equal(pll.status().locked, false);
  assert.equal(pll.status().lockElapsed, 0);
});

test('the pinned SDK initializer preserves its exact RMW order and external MISC2 write', () => {
  for (const [requested, code, misc2Bits] of [[16, 0, 0x00808000], [8, 1, 0x00808000],
    [4, 2, 0x00808000], [2, 1, 0], [1, 2, 0], [9, 2, 0]]) {
    const pll = new Rt1062AudioPll({ lockTicks: 3, referenceClk1Available: true });
    const run = sdkInitialize(pll, { src: 1, loopDivider: 36, numerator: -1,
      denominator: 2, postDivider: requested });
    assert.deepEqual(run.writes, [
      { address: R.CONTROL, value: 0x15006, handled: true },
      { address: R.NUM, value: 0x3fffffff, handled: true },
      { address: R.DENOM, value: 2, handled: true },
      { address: 0x400d8170, value: (0xfa5a5a5a | misc2Bits) >>> 0, handled: false },
      { address: R.CONTROL, value: (0x16024 | (code << 19)) >>> 0, handled: true },
      { address: R.CONTROL, value: (0x80006024 | (code << 19)) >>> 0, handled: true },
    ]);
    assert.equal(run.polling.locked, false);
    assert.equal(run.polling.lockElapsed, 0);
    assert.equal(run.externalMisc2, (0xfa5a5a5a | misc2Bits) >>> 0);
    assert.equal(pll.status().signedNumerator, -1);
    assert.equal(pll.status().postDividerCode, code);
    assert.equal(pll.status().locked, true);
    assert.equal(pll.status().bypassed, false);
  }
});

test('the SDK OR operation retains inherited POST bits including reserved code3', () => {
  for (const inherited of [0, 1, 2, 3]) {
    for (const [requested, requestedCode] of [[16, 0], [8, 1], [4, 2], [2, 1], [1, 2]]) {
      const pll = new Rt1062AudioPll({ lockTicks: 2 });
      pll.write(R.SET, inherited << 19);
      const run = sdkInitialize(pll, { src: 0, loopDivider: 40, numerator: 1,
        denominator: 2, postDivider: requested }, 0xfadada5a);
      const expectedCode = inherited | requestedCode;
      assert.equal(run.polling.postDividerCode, expectedCode);
      assert.equal(pll.status().postDividerCode, expectedCode);
      assert.equal(pll.status().locked, true);
      assert.deepEqual(pll.status().blockingReasons, []);
      assert.equal(pll.status().unsupported.some(value => /POST_DIV_SELECT/.test(value)), expectedCode === 3);
      assert.equal((run.externalMisc2 & ~0x00808000) >>> 0, 0xfa5a5a5a);
      assert.equal(run.externalMisc2 >>> 30, 3);
    }
  }
});

test('reads and masked-identical writes never advance pending lock time', () => {
  const pll = new Rt1062AudioPll({ lockTicks: 3 });
  configure(pll);
  const before = pll.status();
  for (let i = 0; i < 100; i++) {
    for (const address of Object.values(R)) pll.read(address);
    pll.write(R.CONTROL, pll.read(R.CONTROL));
    pll.write(R.NUM, pll.read(R.NUM) | 0xc0000000);
    pll.write(R.DENOM, pll.read(R.DENOM) | 0xc0000000);
    for (const address of [R.SET, R.CLR, R.TOG]) pll.write(address, 0);
  }
  assert.deepEqual(pll.status(), before);
});

test('unchanged loop source and fractional writes preserve pending and completed lock', () => {
  const pll = new Rt1062AudioPll({ lockTicks: 4 });
  configure(pll);
  pll.tick(3);
  for (let i = 0; i < 2; i++) {
    const before = pll.status();
    configure(pll);
    fraction(pll, pll.read(R.NUM) | 0xc0000000, pll.read(R.DENOM) | 0xc0000000);
    assert.deepEqual(pll.status(), before);
    pll.tick();
    assert.equal(pll.status().locked, true);
  }
});

test('actual loop changes clear pending and completed lock and restart the delay', () => {
  const pll = ready({ lockTicks: 3 });
  configure(pll, 40);
  assert.equal(pll.status().locked, false);
  assert.equal(pll.status().lockElapsed, 0);
  pll.tick(2);
  configure(pll, 54);
  assert.equal(pll.status().divider, 54);
  assert.equal(pll.status().lockElapsed, 0);
  pll.tick(3);
  assert.equal(pll.status().locked, true);
});

test('actual reference changes clear pending and completed lock', () => {
  const pll = ready({ lockTicks: 3, referenceClk1Available: true });
  configure(pll, 36, 1);
  assert.equal(pll.status().referenceSource, 'clk1');
  assert.equal(pll.status().locked, false);
  pll.tick(2);
  configure(pll, 36, 0);
  assert.equal(pll.status().referenceSource, 'oscillator24M');
  assert.equal(pll.status().lockElapsed, 0);
  pll.tick(3);
  assert.equal(pll.status().locked, true);
});

test('analog POWERDOWN polarity and all aliases cancel pending or completed lock', () => {
  const pll = ready({ lockTicks: 3 });
  pll.write(R.SET, 0x1000);
  assert.equal(pll.status().poweredDown, true);
  assert.equal(pll.status().locked, false);
  pll.tick(100);
  assert.equal(pll.status().lockElapsed, 0);
  pll.write(R.CLR, 0x1000);
  pll.tick(2);
  pll.write(R.TOG, 0x1000);
  assert.equal(pll.status().lockElapsed, 0);
  pll.write(R.TOG, 0x1000);
  assert.equal(pll.status().poweredDown, false);
  assert.equal(pll.status().locked, false);
  pll.tick(3);
  assert.equal(pll.status().locked, true);
});

test('ENABLE BYPASS and every post-divider code preserve valid analog lock progress', () => {
  const pll = new Rt1062AudioPll({ lockTicks: 4 });
  configure(pll);
  pll.tick(3);
  for (const [code, divisor] of [[0, 4], [1, 2], [2, 1], [3, undefined]]) {
    pll.write(R.CONTROL, (pll.read(R.CONTROL) & ~0x180000) | (code << 19));
    pll.write(R.TOG, 0x12000);
    assert.equal(pll.status().postDividerCode, code);
    assert.equal(pll.status().postDivider, divisor);
    assert.equal(pll.status().lockElapsed, 3);
    assert.deepEqual(pll.status().blockingReasons, []);
    assert.equal(pll.status().unsupported.some(value => /POST_DIV_SELECT/.test(value)), code === 3);
  }
  assert.equal(pll.status().outputEnabled, false);
  assert.equal(pll.status().bypassed, true);
  pll.tick();
  assert.equal(pll.status().locked, true);
  for (const address of [R.SET, R.CLR, R.TOG]) {
    pll.write(address, 0x192000);
    assert.equal(pll.status().locked, true);
    assert.equal(pll.status().lockElapsed, 4);
  }
});

test('all 128 loop divider encodings are retained and only documented27..54 can lock', () => {
  const pll = new Rt1062AudioPll();
  for (let divider = 0; divider <= 127; divider++) {
    configure(pll, divider);
    pll.tick();
    const admitted = divider >= 27 && divider <= 54;
    assert.equal(pll.status().divider, divider);
    assert.equal(pll.status().locked, admitted, `divider ${divider}`);
    assert.equal(pll.status().unsupported.some(value => /DIV_SELECT/.test(value)), !admitted);
  }
});

test('supported source availability comes only from the fixed environmental fixtures', () => {
  for (const reference24MAvailable of [false, true]) {
    for (const referenceClk1Available of [false, true]) {
      for (const source of [0, 1]) {
        const pll = new Rt1062AudioPll({ reference24MAvailable, referenceClk1Available });
        configure(pll, 36, source);
        pll.tick(100);
        const available = source === 0 ? reference24MAvailable : referenceClk1Available;
        assert.equal(pll.status().referenceAvailable, available);
        assert.equal(pll.status().locked, available);
        assert.equal(pll.status().blockingReasons.some(value => /unavailable/.test(value)), !available);
      }
    }
  }
});

test('reserved reference codes2 and3 remain stored and conservatively stall LOCK', () => {
  const pll = ready({ referenceClk1Available: true });
  for (const source of [2, 3]) {
    configure(pll, 36, source);
    pll.tick(0xffffffff);
    assert.equal(pll.status().referenceSourceCode, source);
    assert.equal(pll.status().referenceSource, 'unsupported');
    assert.equal(pll.status().referenceAvailable, false);
    assert.equal(pll.status().locked, false);
    assert.equal(pll.status().lockElapsed, 0);
    assert.ok(pll.status().unsupported.some(value => /BYPASS_CLK_SRC/.test(value)));
  }
  configure(pll);
  assert.equal(pll.status().locked, false);
  pll.tick();
  assert.equal(pll.status().locked, true);
});

test('NUM is signed30 while DENOM is unsigned30 and upper bits read zero', () => {
  const pll = new Rt1062AudioPll();
  pll.write(R.DENOM, 0xffffffff);
  assert.equal(pll.read(R.DENOM), 0x3fffffff);
  assert.equal(pll.status().denominator, 1073741823);
  for (const [raw, signed] of [[0, 0], [1, 1], [0x1fffffff, 536870911],
    [0x20000000, -536870912], [0x3fffffff, -1]]) {
    pll.write(R.NUM, raw | 0xc0000000);
    assert.equal(pll.read(R.NUM), raw);
    assert.equal(pll.status().numerator, raw);
    assert.equal(pll.status().signedNumerator, signed);
    assert.equal(pll.status().fractionalValid, true);
  }
});

test('fraction eligibility uses strict absolute signed numerator less than denominator', () => {
  const pll = new Rt1062AudioPll();
  configure(pll);
  for (const [numerator, denominator, valid] of [[0, 1, true], [1, 2, true], [-1, 2, true],
    [2, 2, false], [-2, 2, false], [3, 2, false], [-3, 2, false],
    [0x1fffffff, 0x20000000, true], [0x1fffffff, 0x1fffffff, false],
    [0x20000000, 0x20000001, true], [0x20000000, 0x20000000, false]]) {
    fraction(pll, numerator, denominator);
    pll.tick();
    assert.equal(pll.status().fractionalValid, valid, `${numerator}/${denominator}`);
    assert.equal(pll.status().locked, valid);
    assert.equal(pll.status().blockingReasons.some(value => /numerator magnitude/.test(value)), !valid);
  }
});

test('zero denominator remains stored and conservatively stalls even zero numerator', () => {
  const pll = ready();
  for (const numerator of [0, 1, -1, 0x20000000]) {
    fraction(pll, numerator, 0);
    pll.tick(0xffffffff);
    assert.equal(pll.read(R.DENOM), 0);
    assert.equal(pll.status().fractionalValid, false);
    assert.equal(pll.status().locked, false);
    assert.equal(pll.status().lockElapsed, 0);
    assert.ok(pll.status().blockingReasons.some(value => /zero denominator/.test(value)));
    assert.ok(pll.status().unsupported.some(value => /Zero-denominator/.test(value)));
  }
  fraction(pll, 0, 1);
  assert.equal(pll.status().locked, false);
  pll.tick();
  assert.equal(pll.status().locked, true);
});

test('actual NUM and DENOM changes clear pending and completed lock independently', () => {
  for (const address of [R.NUM, R.DENOM]) {
    const pll = ready({ lockTicks: 3 });
    const original = pll.read(address);
    pll.write(address, original + 1);
    assert.equal(pll.status().locked, false);
    assert.equal(pll.status().lockElapsed, 0);
    pll.tick(2);
    pll.write(address, original + 2);
    assert.equal(pll.status().lockElapsed, 0);
    pll.tick(3);
    assert.equal(pll.status().locked, true);
  }
});

test('invalid fractional changes discard stale LOCK and recovery needs a fresh delay', () => {
  const pll = ready({ lockTicks: 3 });
  fraction(pll, -2, 2);
  assert.equal(pll.status().locked, false);
  pll.tick(100);
  assert.equal(pll.status().lockElapsed, 0);
  pll.write(R.NUM, -1);
  assert.equal(pll.status().fractionalValid, true);
  pll.tick(2);
  assert.equal(pll.status().locked, false);
  pll.tick();
  assert.equal(pll.status().locked, true);
});

test('SET CLR TOG aliases read zero at all aligned lanes', () => {
  const pll = ready();
  for (const base of [R.SET, R.CLR, R.TOG]) {
    for (const width of [1, 2, 4]) {
      for (let lane = 0; lane < 4; lane += width) assert.equal(pll.read(base + lane, width), 0);
    }
  }
});

test('control aliases act only on selected ones and preserve zero writes', () => {
  const pll = new Rt1062AudioPll();
  pll.write(R.CLR, 0x1006);
  assert.equal(pll.read(R.CONTROL), 0x10000);
  pll.write(R.SET, 0x82024);
  assert.equal(pll.read(R.CONTROL), 0x92024);
  pll.write(R.TOG, 0x180010);
  assert.equal(pll.read(R.CONTROL), 0x112034);
  const before = pll.status();
  for (const address of [R.SET, R.CLR, R.TOG]) pll.write(address, 0);
  assert.deepEqual(pll.status(), before);
});

test('control byte and halfword accesses preserve untouched lanes', () => {
  const pll = ready({ referenceClk1Available: true });
  pll.write(R.CONTROL + 1, 0x60, 1);
  assert.equal(pll.read(R.CONTROL), 0x16024);
  assert.equal(pll.status().referenceSourceCode, 1);
  pll.tick();
  pll.write(R.SET + 2, 0x08, 1);
  assert.equal(pll.read(R.CONTROL), 0x80096024);
  pll.write(R.CLR + 2, 1, 1);
  assert.equal(pll.status().bypassed, false);
  assert.equal(pll.status().locked, true);
  pll.write(R.CONTROL, 0x202a, 2);
  assert.equal(pll.read(R.CONTROL), 0x8202a);
  assert.equal(pll.status().divider, 42);
  pll.tick();
  assert.equal(pll.read(R.CONTROL + 2, 2), 0x8008);
  assert.equal(pll.read(R.CONTROL + 1, 1), 0x20);
});

test('fractional byte and halfword accesses are little endian with protected upper bits', () => {
  const pll = new Rt1062AudioPll();
  for (const address of [R.NUM, R.DENOM]) {
    pll.write(address, 0x12345678);
    assert.equal(pll.read(address + 1, 1), 0x56);
    assert.equal(pll.read(address + 2, 2), 0x1234);
    pll.write(address + 1, 0xab, 1);
    assert.equal(pll.read(address), 0x1234ab78);
    pll.write(address + 2, 0xcdef, 2);
    assert.equal(pll.read(address), 0x0defab78);
    pll.write(address + 3, 0xff, 1);
    assert.equal(pll.read(address), 0x3fefab78);
    pll.write(address, 0x9876, 2);
    assert.equal(pll.read(address), 0x3fef9876);
  }
});

test('unwritten value bits cannot affect another lane or fractional upper fields', () => {
  const pll = ready();
  const before = pll.status();
  pll.write(R.SET, 0x81181000, 1);
  pll.write(R.TOG, 0x80190000, 2);
  pll.write(R.CLR + 3, 0x80000000, 1);
  pll.write(R.NUM, pll.read(R.NUM) | 0xffffff00, 1);
  pll.write(R.DENOM, pll.read(R.DENOM) | 0xffff0000, 2);
  assert.deepEqual(pll.status(), before);
});

test('LOCK stays read only through every control alias and lane width', () => {
  for (const base of [R.SET, R.CLR, R.TOG]) {
    const pll = ready();
    pll.write(base, 0x80000000);
    pll.write(base + 3, 0x80, 1);
    pll.write(base + 2, 0x8000, 2);
    assert.equal(pll.status().locked, true);
    const fresh = new Rt1062AudioPll();
    fresh.write(base, 0x80000000);
    fresh.write(base + 3, 0x80, 1);
    assert.equal(fresh.status().locked, false);
  }
  const pll = ready();
  pll.write(R.CONTROL, pll.read(R.CONTROL) & 0x7fffffff);
  pll.write(R.CONTROL + 3, 0, 1);
  pll.write(R.CONTROL + 2, pll.read(R.CONTROL + 2, 2) & 0x7fff, 2);
  assert.equal(pll.status().locked, true);
  const fresh = new Rt1062AudioPll();
  fresh.write(R.CONTROL, fresh.read(R.CONTROL) | 0x80000000);
  assert.equal(fresh.status().locked, false);
});

test('reserved control bits remain zero while every actual field remains writable', () => {
  const pll = new Rt1062AudioPll();
  pll.write(R.CONTROL, 0xffffffff);
  assert.equal(pll.read(R.CONTROL), 0x19f07f);
  pll.write(R.CONTROL, 0);
  assert.equal(pll.read(R.CONTROL), 0);
  const before = pll.status();
  for (const address of [R.SET, R.CLR, R.TOG]) pll.write(address, 0x7fe60f80);
  assert.deepEqual(pll.status(), before);
});

test('equivalent batched ticks preserve the same pending and completed state', () => {
  const whole = new Rt1062AudioPll({ lockTicks: 7 });
  const split = new Rt1062AudioPll({ lockTicks: 7 });
  configure(whole); configure(split);
  whole.tick(6);
  for (const count of [2, 0, 3, 1]) split.tick(count);
  assert.deepEqual(whole.status(), split.status());
  whole.tick(10); split.tick(5); split.tick(5);
  assert.deepEqual(whole.status(), split.status());
  assert.equal(whole.status().lockElapsed, 7);
  assert.equal(whole.status().ticks, 16);
});

test('zero-delay lock still requires an explicit tick after eligibility or parameter change', () => {
  const pll = new Rt1062AudioPll({ lockTicks: 0 });
  pll.tick(0);
  assert.equal(pll.status().locked, false);
  configure(pll);
  assert.equal(pll.status().locked, false);
  pll.tick(0);
  assert.equal(pll.status().locked, true);
  pll.write(R.NUM, 1);
  assert.equal(pll.status().locked, false);
  pll.tick(0);
  assert.equal(pll.status().locked, true);
});

test('tick bounds reject invalid counts and delays without changing model state', () => {
  const pll = new Rt1062AudioPll({ lockTicks: 0xffffffff });
  configure(pll);
  pll.tick(0xfffffffe);
  assert.equal(pll.status().locked, false);
  const before = pll.status();
  for (const count of [-1, 0.5, NaN, Infinity, 0x100000000, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => pll.tick(count), RangeError);
    assert.throws(() => new Rt1062AudioPll({ lockTicks: count }), RangeError);
    assert.deepEqual(pll.status(), before);
  }
  pll.tick();
  assert.equal(pll.status().locked, true);
});

test('fixed lock failure never completes and remains fixed after reset', () => {
  const pll = new Rt1062AudioPll({ lockFailure: true });
  for (let i = 0; i < 2; i++) {
    configure(pll);
    pll.tick(0xffffffff);
    assert.equal(pll.status().locked, false);
    assert.equal(pll.status().lockElapsed, 0);
    assert.ok(pll.status().blockingReasons.some(value => /lock-failure/.test(value)));
    pll.reset();
  }
});

test('boolean fixtures are validated and status snapshots cannot alter future state', () => {
  for (const name of ['lockFailure', 'reference24MAvailable', 'referenceClk1Available']) {
    for (const value of [0, 1, null, 'false']) assert.throws(() => new Rt1062AudioPll({ [name]: value }), TypeError);
  }
  const pll = ready();
  const snapshot = pll.status();
  snapshot.configuration.lockFailure = true;
  snapshot.configuration.lockTicks = 0;
  snapshot.blockingReasons.push('invented'); snapshot.unsupported.push('invented');
  snapshot.numerator = 0; snapshot.denominator = 0;
  assert.equal(pll.status().configuration.lockFailure, false);
  assert.equal(pll.status().configuration.lockTicks, 1);
  assert.equal(pll.status().numerator, 0x05f5e100);
  assert.equal(pll.status().denominator, 0x2964619c);
  assert.deepEqual(pll.status().blockingReasons, []);
  assert.deepEqual(pll.status().unsupported, []);
  assert.ok(Object.isFrozen(pll.status().limitations));
});

test('reset restores all three words and progress but retains the fixed fixtures', () => {
  const options = { lockTicks: 4, lockFailure: false, reference24MAvailable: false, referenceClk1Available: true };
  const pll = new Rt1062AudioPll(options);
  configure(pll, 54, 1);
  fraction(pll, -1, 2);
  pll.tick(4);
  pll.write(R.SET, 0x180000);
  pll.reset();
  assert.equal(pll.read(R.CONTROL), 0x11006);
  assert.equal(pll.read(R.NUM), 0x05f5e100);
  assert.equal(pll.read(R.DENOM), 0x2964619c);
  assert.equal(pll.status().locked, false);
  assert.equal(pll.status().lockElapsed, 0);
  assert.equal(pll.status().ticks, 0);
  assert.deepEqual(pll.status().configuration, options);
  configure(pll); pll.tick(100);
  assert.equal(pll.status().locked, false);
  configure(pll, 36, 1); pll.tick(4);
  assert.equal(pll.status().locked, true);
});

test('exact24-byte ownership leaves both reserved gaps and neighboring PLLs unhandled', () => {
  const pll = new Rt1062AudioPll();
  const before = pll.status();
  let ownedBytes = 0;
  for (let address = 0x400d8060; address < 0x400d80c4; address++) {
    const owned = (address >= 0x400d8070 && address < 0x400d8084) ||
      (address >= 0x400d8090 && address < 0x400d8094);
    assert.equal(pll.handles(address, 1), owned, address.toString(16));
    if (owned) ownedBytes++;
    else {
      assert.equal(pll.read(address, 1), undefined);
      assert.equal(pll.write(address, 0xff, 1), false);
    }
  }
  assert.equal(ownedBytes, 24);
  for (const base of Object.values(R)) {
    for (const width of [1, 2, 4]) {
      for (let lane = 0; lane < 4; lane += width) assert.equal(pll.handles(base + lane, width), true);
    }
  }
  for (const address of [0x400d8000, 0x400d8010, 0x400d8020, 0x400d8030, 0x400d8060,
    0x400d8084, 0x400d8088, 0x400d808c, 0x400d8094, 0x400d8098, 0x400d809c,
    0x400d80a0, 0x400d80a4, 0x400d80a8, 0x400d80ac, 0x400d80b0, 0x400d80c0,
    0x400d80e0, 0x400d80f0, 0x400d8100, 0x400d8170, 0x400fc048]) {
    assert.equal(pll.handles(address), false);
    assert.equal(pll.read(address), undefined);
    assert.equal(pll.write(address, 0xffffffff), false);
  }
  assert.deepEqual(pll.status(), before);
});

test('malformed widths addresses and cross-lane accesses remain unhandled without mutation', () => {
  const pll = new Rt1062AudioPll();
  const before = pll.status();
  for (const base of Object.values(R)) {
    for (const [address, width] of [[base, 0], [base, 3], [base, 8], [base + 1, 2],
      [base + 1, 4], [base + 3, 2], [base + 0.5, 1], [-1, 1], [NaN, 4],
      [Infinity, 4], [base + 0x100000000, 4]]) {
      assert.equal(pll.handles(address, width), false);
      assert.equal(pll.read(address, width), undefined);
      assert.equal(pll.write(address, 0xffffffff, width), false);
    }
  }
  assert.deepEqual(pll.status(), before);
});

test('the SDK split MISC2 mask preserves every VIDEO code and non-AUDIO bit', () => {
  for (const videoCode of [0, 1, 2, 3]) {
    for (const inheritedAudioBits of [0, 0x8000, 0x800000, 0x808000]) {
      for (const [requested, expectedAudioBits] of [[2, 0], [8, 0x808000]]) {
        const initial = (0x3a5a5a5a | (videoCode << 30) | inheritedAudioBits) >>> 0;
        const pll = new Rt1062AudioPll();
        const run = sdkInitialize(pll, { src: 0, loopDivider: 36, numerator: 1,
          denominator: 2, postDivider: requested }, initial);
        const expected = (0x3a5a5a5a | (videoCode << 30) | expectedAudioBits) >>> 0;
        assert.equal(run.externalMisc2, expected);
        assert.equal(run.externalMisc2 >>> 30, videoCode);
        assert.equal((run.externalMisc2 & ~0x808000) >>> 0, (initial & ~0x808000) >>> 0);
        assert.deepEqual(run.writes.filter(value => value.address === 0x400d8170),
          [{ address: 0x400d8170, value: expected, handled: false }]);
      }
    }
  }
});

test('SDK deinit writes only POWERDOWN and preserves fractional words without resetting ticks', () => {
  // CLOCK_DeinitAudioPll at pinned SDK lines 797..800 writes CONTROL = 0x1000.
  for (const elapsed of [2, 3]) {
    const pll = new Rt1062AudioPll({ lockTicks: 3, referenceClk1Available: true });
    configure(pll, 40, 1);
    fraction(pll, -1, 2);
    pll.write(R.SET, 0x102000);
    pll.write(R.CLR, 0x10000);
    pll.tick(elapsed);
    assert.equal(pll.status().locked, elapsed === 3);
    pll.write(R.CONTROL, 0x1000);
    assert.equal(pll.read(R.CONTROL), 0x1000);
    assert.equal(pll.read(R.NUM), 0x3fffffff);
    assert.equal(pll.read(R.DENOM), 2);
    assert.equal(pll.status().ticks, elapsed);
    assert.equal(pll.status().lockElapsed, 0);
    assert.equal(pll.status().locked, false);
    assert.equal(pll.status().poweredDown, true);
    assert.equal(pll.status().divider, 0);
    assert.equal(pll.status().referenceSourceCode, 0);
    assert.equal(pll.status().postDividerCode, 0);
    assert.equal(pll.status().outputEnabled, false);
    assert.equal(pll.status().bypassed, false);
    pll.tick(100);
    assert.equal(pll.status().locked, false);
  }
});

