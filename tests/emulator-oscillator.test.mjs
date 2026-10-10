import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Rt1062Oscillator, OSCILLATOR_REG as R, OSCILLATOR_BITS as B,
  OSCILLATOR_RESET, OSCILLATOR_EVIDENCE, OSCILLATOR_LIMITATIONS,
} from '../src/lib/emulator/oscillator.ts';

function ready(options) {
  const clock = new Rt1062Oscillator(options);
  clock.tick(clock.status().configuration.powerUpTicks);
  clock.write(R.MISC0_SET, B.OSC_XTALOK_EN);
  clock.tick(clock.status().configuration.frequencyDetectTicks);
  assert.equal(clock.status().crystalOk, true);
  return clock;
}

test('source pins identify the reviewed NXP driver, manual, and header', () => {
  assert.match(OSCILLATOR_EVIDENCE.driver, /6f3fd257cdcf978a4d26e7d6e9eed9240037422b\/devices\/MIMXRT1062\/drivers\/fsl_clock.c$/);
  for (const key of ['driverSha256', 'manualSha256', 'headerSha256']) {
    assert.match(OSCILLATOR_EVIDENCE[key], /^[a-f0-9]{64}$/);
  }
  assert.ok(OSCILLATOR_LIMITATIONS.some(value => /synthetic ticks/.test(value)));
});

test('reset uses source values with power-down clear and both oscillator statuses low', () => {
  const clock = new Rt1062Oscillator();
  assert.deepEqual(OSCILLATOR_RESET, { MISC0: 0x04000000, LOWPWR_CTRL: 0x4001 });
  assert.equal(clock.read(R.MISC0), 0x04000000);
  assert.equal(clock.read(R.LOWPWR_CTRL), 0x4001);
  assert.equal(clock.status().poweredDown, false);
  assert.equal(clock.status().powerUpReady, false);
  assert.equal(clock.status().detectorEnabled, false);
  assert.equal(clock.status().crystalOk, false);
});

test('reads and control writes leave synthetic time unchanged', () => {
  const clock = new Rt1062Oscillator();
  clock.write(R.MISC0_CLR, B.XTAL_24M_PWD);
  clock.write(R.MISC0_SET, B.OSC_XTALOK_EN);
  const expected = clock.status();
  for (let i = 0; i < 100; i++) {
    clock.read(R.LOWPWR_CTRL);
    clock.read(R.MISC0);
    clock.read(R.MISC0_SET);
  }
  assert.deepEqual(clock.status(), expected);
  assert.equal(clock.status().powerUpReady, false);
});

test('NXP initialization sequence reaches each status only after its explicit tick phase', () => {
  const clock = new Rt1062Oscillator({ powerUpTicks: 3, frequencyDetectTicks: 2 });
  clock.write(R.MISC0_CLR, B.XTAL_24M_PWD);
  clock.tick(2);
  assert.equal(clock.read(R.LOWPWR_CTRL) & B.XTALOSC_PWRUP_STAT, 0);
  clock.tick(1);
  assert.equal(clock.read(R.LOWPWR_CTRL) & B.XTALOSC_PWRUP_STAT, B.XTALOSC_PWRUP_STAT);
  assert.equal(clock.read(R.MISC0) & B.OSC_XTALOK, 0);
  clock.write(R.MISC0_SET, B.OSC_XTALOK_EN);
  clock.tick(1);
  assert.equal(clock.read(R.MISC0) & B.OSC_XTALOK, 0);
  clock.tick(1);
  assert.equal(clock.read(R.MISC0) & B.OSC_XTALOK, B.OSC_XTALOK);
  clock.write(R.MISC0_CLR, B.OSC_XTALOK_EN);
  assert.equal(clock.status().detectorEnabled, false);
  assert.equal(clock.status().crystalOk, true);
});

test('early detection uses only ticks after power-up, independent of tick batching', () => {
  const options = { powerUpTicks: 4, frequencyDetectTicks: 3 };
  const whole = new Rt1062Oscillator(options), split = new Rt1062Oscillator(options);
  whole.write(R.MISC0_SET, B.OSC_XTALOK_EN);
  split.write(R.MISC0_SET, B.OSC_XTALOK_EN);
  whole.tick(6);
  for (const ticks of [2, 1, 2, 1]) split.tick(ticks);
  assert.deepEqual(whole.status(), split.status());
  assert.equal(whole.status().powerUpReady, true);
  assert.equal(whole.status().detectionElapsed, 2);
  assert.equal(whole.status().crystalOk, false);
  whole.tick(1); split.tick(1);
  assert.deepEqual(whole.status(), split.status());
  assert.equal(whole.status().crystalOk, true);
});

test('power-down cancels a pending power-up and holds both status bits low', () => {
  const clock = new Rt1062Oscillator({ powerUpTicks: 3 });
  clock.tick(2);
  clock.write(R.MISC0_SET, B.XTAL_24M_PWD | B.OSC_XTALOK_EN);
  clock.tick(100);
  assert.equal(clock.status().powerUpElapsed, 0);
  assert.equal(clock.status().detectionElapsed, 0);
  assert.equal(clock.status().powerUpReady, false);
  assert.equal(clock.status().crystalOk, false);
  clock.write(R.MISC0_CLR, B.XTAL_24M_PWD);
  clock.tick(2);
  assert.equal(clock.status().powerUpReady, false);
  clock.tick(1);
  assert.equal(clock.status().powerUpReady, true);
  assert.equal(clock.status().crystalOk, false);
  clock.tick(1);
  assert.equal(clock.status().crystalOk, true);
});

test('toggle power-down clears a completed result and starts a fresh power-up', () => {
  const clock = ready();
  clock.write(R.MISC0_TOG, B.XTAL_24M_PWD);
  assert.equal(clock.status().poweredDown, true);
  assert.equal(clock.status().powerUpReady, false);
  assert.equal(clock.status().crystalOk, false);
  clock.write(R.MISC0_TOG, B.XTAL_24M_PWD);
  assert.equal(clock.status().powerUpReady, false);
  clock.tick(2);
  assert.equal(clock.status().crystalOk, true);
});

test('detector disable retains completed XTALOK and re-enable starts a new detection', () => {
  const clock = ready({ frequencyDetectTicks: 3 });
  clock.write(R.MISC0_CLR, B.OSC_XTALOK_EN);
  clock.tick(100);
  assert.equal(clock.status().crystalOk, true);
  clock.write(R.MISC0_SET, B.OSC_XTALOK_EN);
  assert.equal(clock.status().crystalOk, false);
  clock.tick(2);
  assert.equal(clock.status().crystalOk, false);
  clock.tick(1);
  assert.equal(clock.status().crystalOk, true);
});

test('detector disable cancels partial progress without completing it', () => {
  const clock = new Rt1062Oscillator({ frequencyDetectTicks: 3 });
  clock.tick();
  clock.write(R.MISC0_SET, B.OSC_XTALOK_EN);
  clock.tick(2);
  clock.write(R.MISC0_CLR, B.OSC_XTALOK_EN);
  clock.tick(100);
  assert.equal(clock.status().crystalOk, false);
  assert.equal(clock.status().detectionElapsed, 0);
  clock.write(R.MISC0_SET, B.OSC_XTALOK_EN);
  clock.tick(1);
  assert.equal(clock.status().detectionElapsed, 1);
  assert.equal(clock.status().crystalOk, false);
});

test('power-up failure leaves both statuses low even with detection enabled', () => {
  const clock = new Rt1062Oscillator({ powerUpFailure: true });
  clock.write(R.MISC0_SET, B.OSC_XTALOK_EN);
  clock.tick(0xffffffff);
  assert.equal(clock.status().powerUpReady, false);
  assert.equal(clock.status().crystalOk, false);
  assert.equal(clock.status().detectionElapsed, 0);
});

test('frequency failure permits power-up readiness but never XTALOK or a fictitious bit17 error', () => {
  const clock = new Rt1062Oscillator({ frequencyFailure: true });
  clock.write(R.MISC0_SET, B.OSC_XTALOK_EN | 0x20000);
  clock.tick(100);
  assert.equal(clock.status().powerUpReady, true);
  assert.equal(clock.status().crystalOk, false);
  assert.equal(clock.read(R.MISC0) & 0x20000, 0);
});

test('every SET/CLR/TOG alias reads zero at every aligned byte lane', () => {
  const clock = ready();
  for (const base of [R.MISC0, R.LOWPWR_CTRL]) {
    assert.notEqual(clock.read(base), 0);
    for (const offset of [4, 8, 12]) {
      for (const width of [1, 2, 4]) {
        for (let lane = 0; lane < 4; lane += width) assert.equal(clock.read(base + offset + lane, width), 0);
      }
    }
  }
});

test('primary byte and halfword writes preserve other documented control lanes', () => {
  const clock = new Rt1062Oscillator();
  clock.write(R.MISC0, 0x80001059);
  clock.write(R.MISC0 + 1, 0x64, 1);
  assert.equal(clock.read(R.MISC0), 0x80006459);
  clock.write(R.MISC0 + 2, 0x1001, 2);
  assert.equal(clock.read(R.MISC0), 0x10016459);
  assert.equal(clock.read(R.MISC0 + 3, 1), 0x10);
  assert.equal(clock.read(R.MISC0 + 2, 2), 0x1001);
  clock.write(R.LOWPWR_CTRL, 0x0002c4f1);
  clock.write(R.LOWPWR_CTRL + 1, 0x2b, 1);
  assert.equal(clock.read(R.LOWPWR_CTRL), 0x00022bf1);
  clock.write(R.LOWPWR_CTRL + 2, 4, 2);
  assert.equal(clock.read(R.LOWPWR_CTRL), 0x00042bf1);
});

test('SET/CLR/TOG operate only on selected ones in the written byte lanes', () => {
  const clock = new Rt1062Oscillator();
  clock.write(R.MISC0_SET, 0x50, 1);
  assert.equal(clock.read(R.MISC0), 0x04000050);
  clock.write(R.MISC0_CLR, 0x10, 1);
  clock.write(R.MISC0_TOG, 0x60, 1);
  assert.equal(clock.read(R.MISC0), 0x04000020);
  clock.write(R.MISC0_SET + 3, 0x40, 1);
  assert.equal(clock.status().poweredDown, true);
  clock.write(R.MISC0_CLR + 3, 0x40, 1);
  assert.equal(clock.status().poweredDown, false);
  for (const base of [R.MISC0, R.LOWPWR_CTRL]) {
    const expected = clock.read(base);
    for (const offset of [4, 8, 12]) clock.write(base + offset, 0);
    assert.equal(clock.read(base), expected);
  }
});

test('unwritten high value bits cannot power down or enable detection during a narrow write', () => {
  const clock = ready();
  clock.write(R.MISC0_CLR, B.OSC_XTALOK_EN);
  clock.write(R.MISC0_SET, B.XTAL_24M_PWD | B.OSC_XTALOK_EN | 8, 1);
  assert.equal(clock.status().poweredDown, false);
  assert.equal(clock.status().detectorEnabled, false);
  assert.equal(clock.status().crystalOk, true);
  clock.write(R.MISC0_TOG, B.XTAL_24M_PWD | B.OSC_XTALOK_EN, 2);
  assert.equal(clock.status().poweredDown, false);
  assert.equal(clock.status().detectorEnabled, false);
  const before = clock.read(R.LOWPWR_CTRL);
  clock.write(R.LOWPWR_CTRL_SET, 0x00060010, 1);
  assert.equal(clock.read(R.LOWPWR_CTRL), before | 0x10);
});

test('oscillator status and fixed source/bandgap fixtures cannot be written through any alias', () => {
  for (const alias of [0, 4, 8, 12]) {
    const clock = ready();
    clock.write(R.MISC0 + alias, B.OSC_XTALOK | B.RTC_XTAL_SOURCE | B.REFTOP_VBGUP);
    clock.write(R.LOWPWR_CTRL + alias, B.XTALOSC_PWRUP_STAT);
    assert.equal(clock.read(R.MISC0) & B.OSC_XTALOK, B.OSC_XTALOK);
    assert.equal(clock.read(R.MISC0) & (B.RTC_XTAL_SOURCE | B.REFTOP_VBGUP), 0);
    assert.equal(clock.read(R.LOWPWR_CTRL) & B.XTALOSC_PWRUP_STAT, B.XTALOSC_PWRUP_STAT);
    const fresh = new Rt1062Oscillator();
    fresh.write(R.MISC0 + alias, B.OSC_XTALOK);
    fresh.write(R.LOWPWR_CTRL + alias, B.XTALOSC_PWRUP_STAT);
    assert.equal(fresh.status().crystalOk, false);
    assert.equal(fresh.status().powerUpReady, false);
  }
});

test('status lanes remain protected on byte and halfword writes', () => {
  const clock = ready();
  clock.write(R.MISC0_CLR + 1, 0x80, 1);
  clock.write(R.MISC0_TOG + 1, 0x8000, 2); // Unaligned, unhandled.
  clock.write(R.MISC0, 0x8000, 2);
  clock.write(R.LOWPWR_CTRL_CLR + 2, 1, 1);
  clock.write(R.LOWPWR_CTRL_TOG + 2, 1, 2);
  assert.equal(clock.status().crystalOk, true);
  assert.equal(clock.status().powerUpReady, true);
});

test('unsigned VID_PLL_PREDIV survives word and subword reads without changing readiness', () => {
  const clock = ready();
  clock.write(R.MISC0_SET + 3, 0x80, 1);
  assert.equal(clock.read(R.MISC0), 0x84018000);
  assert.equal(clock.read(R.MISC0 + 3, 1), 0x84);
  assert.equal(clock.read(R.MISC0 + 2, 2), 0x8401);
  assert.equal(clock.status().powerUpReady, true);
  assert.equal(clock.status().crystalOk, true);
});

test('unrelated documented controls retain values while reserved fields stay zero', () => {
  const clock = new Rt1062Oscillator();
  clock.write(R.MISC0_SET, 0x81ff7fff);
  assert.equal(clock.read(R.MISC0), 0x84017c79);
  clock.write(R.LOWPWR_CTRL_SET, 0xfffeffff);
  assert.equal(clock.read(R.LOWPWR_CTRL), 0x0006eff1);
  assert.equal(clock.status().powerUpReady, false);
  assert.equal(clock.status().crystalOk, false);
  clock.tick(2);
  assert.equal(clock.status().crystalOk, true);
});

test('register delay fields retain their source encoding without changing configured synthetic delays', () => {
  const clock = new Rt1062Oscillator({ powerUpTicks: 5, frequencyDetectTicks: 2 });
  clock.write(R.LOWPWR_CTRL_CLR, 0xc000);
  clock.write(R.MISC0_SET, 0x1c000000 | B.OSC_XTALOK_EN);
  clock.tick(4);
  assert.equal(clock.status().powerUpReady, false);
  clock.tick(1);
  assert.equal(clock.status().powerUpReady, true);
  assert.equal(clock.status().crystalOk, false);
  clock.tick(2);
  assert.equal(clock.status().crystalOk, true);
});

test('unknown, out-of-range, unaligned, and invalid-width accesses remain unhandled', () => {
  const clock = new Rt1062Oscillator();
  const before = clock.status();
  for (const address of [0x400d814c, 0x400d8160, 0x400d826c, 0x400d8280, 0x400d82a0,
    0x400d8010, 0, -1, 0x1400d8150, NaN, R.MISC0 + 1]) {
    assert.equal(clock.handles(address), false);
    assert.equal(clock.read(address), undefined);
    assert.equal(clock.write(address, 0xffffffff), false);
  }
  for (const width of [0, 3, 8]) {
    assert.equal(clock.handles(R.MISC0, width), false);
    assert.equal(clock.read(R.MISC0, width), undefined);
    assert.equal(clock.write(R.MISC0, 0xffffffff, width), false);
  }
  assert.equal(clock.write(R.MISC0 + 1, 0xffff, 2), false);
  assert.deepEqual(clock.status(), before);
  for (const base of [R.MISC0, R.LOWPWR_CTRL]) {
    for (let lane = 0; lane < 16; lane++) assert.equal(clock.handles(base + lane, 1), true);
  }
});

test('reset restores registers and timing while keeping configured delay/failure fixtures', () => {
  const clock = new Rt1062Oscillator({ powerUpTicks: 3, frequencyDetectTicks: 4, frequencyFailure: true });
  clock.write(R.MISC0_SET, B.OSC_XTALOK_EN | 0x80000000);
  clock.tick(100);
  clock.write(R.LOWPWR_CTRL_SET, 0x20);
  const configuration = clock.status().configuration;
  clock.reset();
  assert.equal(clock.read(R.MISC0), OSCILLATOR_RESET.MISC0);
  assert.equal(clock.read(R.LOWPWR_CTRL), OSCILLATOR_RESET.LOWPWR_CTRL);
  assert.equal(clock.status().ticks, 0);
  assert.equal(clock.status().powerUpReady, false);
  assert.equal(clock.status().crystalOk, false);
  assert.deepEqual(clock.status().configuration, configuration);
  clock.tick(2);
  assert.equal(clock.status().powerUpReady, false);
});

test('status returns independent configuration data', () => {
  const clock = new Rt1062Oscillator();
  clock.status().configuration.powerUpFailure = true;
  clock.status().configuration.powerUpTicks = 100;
  clock.tick();
  assert.equal(clock.status().powerUpReady, true);
  assert.equal(clock.status().configuration.powerUpTicks, 1);
});

test('zero-duration phases need an explicit tick and invalid tick configuration is rejected', () => {
  const clock = new Rt1062Oscillator({ powerUpTicks: 0, frequencyDetectTicks: 0 });
  clock.write(R.MISC0_SET, B.OSC_XTALOK_EN);
  assert.equal(clock.status().powerUpReady, false);
  assert.equal(clock.status().crystalOk, false);
  clock.tick(0);
  assert.equal(clock.status().powerUpReady, true);
  assert.equal(clock.status().crystalOk, true);
  for (const ticks of [-1, 0.5, Infinity, NaN, 0x100000000]) {
    const before = clock.status();
    assert.throws(() => clock.tick(ticks), RangeError);
    assert.deepEqual(clock.status(), before);
    assert.throws(() => new Rt1062Oscillator({ powerUpTicks: ticks }), RangeError);
    assert.throws(() => new Rt1062Oscillator({ frequencyDetectTicks: ticks }), RangeError);
  }
});
