import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Rt1062ArmPll, PLL_ARM_REG as R, PLL_ARM_BITS as B, PLL_ARM_RESET,
  PLL_ARM_WRITABLE, PLL_ARM_EVIDENCE, PLL_ARM_LIMITATIONS,
} from '../src/lib/emulator/pll-arm.ts';

function configure(pll, divider = 88, source = 0) {
  pll.write(R.CONTROL, (pll.read(R.CONTROL) & ~(0x7f | 0xc000 | 0x1000)) | divider | (source << 14));
}
function ready(options) {
  const pll = new Rt1062ArmPll(options);
  configure(pll);
  pll.tick(pll.status().configuration.lockTicks);
  assert.equal(pll.status().locked, true);
  return pll;
}

test('evidence identifies source-qualified ARM control and explicit synthetic limits', () => {
  assert.match(PLL_ARM_EVIDENCE.driver, /6f3fd257cdcf978a4d26e7d6e9eed9240037422b\/devices\/MIMXRT1062\/drivers\/fsl_clock.c$/);
  for (const name of ['manualSha256', 'headerSha256', 'driverSha256']) assert.match(PLL_ARM_EVIDENCE[name], /^[a-f0-9]{64}$/);
  assert.ok(PLL_ARM_LIMITATIONS.some(value => /synthetic ticks/.test(value)));
  assert.ok(PLL_ARM_LIMITATIONS.some(value => /Other PLLs/.test(value)));
});

test('literal reset is powered down, bypassed and output-enabled with LOCK low', () => {
  const pll = new Rt1062ArmPll();
  assert.equal(PLL_ARM_RESET, 0x13063);
  assert.equal(PLL_ARM_WRITABLE, 0x1f07f);
  assert.equal(pll.read(R.CONTROL), 0x13063);
  assert.equal(pll.status().divider, 99);
  assert.equal(pll.status().poweredDown, true);
  assert.equal(pll.status().bypassed, true);
  assert.equal(pll.status().outputEnabled, true);
  assert.equal(pll.status().locked, false);
  pll.tick(0xffffffff);
  assert.equal(pll.status().locked, false);
  assert.equal(pll.status().lockElapsed, 0);
});

test('the independent NXP ARM initialization caller locks while bypass remains set', () => {
  const pll = new Rt1062ArmPll({ lockTicks: 3 });
  // CLOCK_InitArmPll: bypass/source, divider and power, poll, then remove bypass.
  pll.write(R.CONTROL, (pll.read(R.CONTROL) & ~0xc000) | 0x10000);
  pll.write(R.CONTROL, (pll.read(R.CONTROL) & ~(0x7f | 0x1000)) | 0x2000 | 88);
  assert.equal(pll.read(R.CONTROL), 0x12058);
  assert.equal(pll.read(R.CONTROL) >>> 31, 0);
  pll.tick(2);
  assert.equal(pll.read(R.CONTROL) >>> 31, 0);
  pll.tick();
  assert.equal(pll.read(R.CONTROL) >>> 31, 1);
  assert.equal(pll.status().bypassed, true);
  pll.write(R.CONTROL, pll.read(R.CONTROL) & ~0x10000);
  assert.equal(pll.status().locked, true);
  assert.equal(pll.status().bypassed, false);
});

test('reads and writes alone do not advance pending lock time', () => {
  const pll = new Rt1062ArmPll({ lockTicks: 3 });
  configure(pll);
  const before = pll.status();
  for (let i = 0; i < 200; i++) {
    pll.read(R.CONTROL);
    pll.read(R.CONTROL + 3, 1);
    pll.write(R.CONTROL, pll.read(R.CONTROL));
    pll.write(R.SET, 0);
    pll.write(R.CLR, 0);
    pll.write(R.TOG, 0);
  }
  assert.deepEqual(pll.status(), before);
});

test('unchanged divider/source writes preserve pending progress and completed lock', () => {
  const pll = new Rt1062ArmPll({ lockTicks: 4 });
  configure(pll);
  pll.tick(3);
  configure(pll);
  assert.equal(pll.status().lockElapsed, 3);
  pll.tick();
  const before = pll.status();
  configure(pll);
  assert.deepEqual(pll.status(), before);
});

test('a changed divider removes stale LOCK and restarts its explicit delay', () => {
  const pll = ready({ lockTicks: 3 });
  configure(pll, 96);
  assert.equal(pll.status().divider, 96);
  assert.equal(pll.status().locked, false);
  assert.equal(pll.status().lockElapsed, 0);
  pll.tick(2);
  assert.equal(pll.status().locked, false);
  configure(pll, 100);
  assert.equal(pll.status().lockElapsed, 0);
  pll.tick(3);
  assert.equal(pll.status().locked, true);
});

test('changing reference source restarts pending and completed lock', () => {
  const pll = ready({ lockTicks: 3, referenceClk1Available: true });
  configure(pll, 88, 1);
  assert.equal(pll.status().referenceSource, 'clk1');
  assert.equal(pll.status().locked, false);
  pll.tick(2);
  configure(pll, 88, 0);
  assert.equal(pll.status().referenceSource, 'oscillator24M');
  assert.equal(pll.status().lockElapsed, 0);
  pll.tick(3);
  assert.equal(pll.status().locked, true);
});

test('POWERDOWN clear enables locking and set cancels completed or pending progress', () => {
  const pll = ready({ lockTicks: 3 });
  pll.write(R.SET, 0x1000);
  assert.equal(pll.status().poweredDown, true);
  assert.equal(pll.status().locked, false);
  pll.tick(100);
  assert.equal(pll.status().lockElapsed, 0);
  pll.write(R.CLR, 0x1000);
  pll.tick(2);
  assert.equal(pll.status().locked, false);
  pll.write(R.SET, 0x1000);
  assert.equal(pll.status().lockElapsed, 0);
  pll.write(R.CLR, 0x1000);
  pll.tick(3);
  assert.equal(pll.status().locked, true);
});

test('toggled POWERDOWN follows the non-USB power polarity', () => {
  const pll = ready();
  pll.write(R.TOG, 0x1000);
  assert.equal(pll.status().poweredDown, true);
  assert.equal(pll.status().locked, false);
  pll.write(R.TOG, 0x1000);
  assert.equal(pll.status().poweredDown, false);
  assert.equal(pll.status().locked, false);
  pll.tick();
  assert.equal(pll.status().locked, true);
});

test('ENABLE and BYPASS do not block analog locking or reset valid progress', () => {
  const pll = new Rt1062ArmPll({ lockTicks: 4 });
  configure(pll);
  pll.write(R.CLR, 0x2000);
  pll.tick(3);
  assert.equal(pll.status().outputEnabled, false);
  assert.equal(pll.status().bypassed, true);
  assert.equal(pll.status().lockElapsed, 3);
  pll.write(R.TOG, 0x12000);
  assert.equal(pll.status().outputEnabled, true);
  assert.equal(pll.status().bypassed, false);
  assert.equal(pll.status().lockElapsed, 3);
  pll.tick();
  assert.equal(pll.status().locked, true);
  pll.write(R.TOG, 0x12000);
  assert.equal(pll.status().locked, true);
});

test('both supported reference sources require their explicit available fixtures', () => {
  const unavailable24 = new Rt1062ArmPll({ reference24MAvailable: false });
  configure(unavailable24);
  unavailable24.tick(100);
  assert.equal(unavailable24.status().locked, false);
  assert.equal(unavailable24.status().referenceAvailable, false);
  assert.ok(unavailable24.status().blockingReasons.some(value => /unavailable/.test(value)));
  const unavailableClk1 = ready();
  configure(unavailableClk1, 88, 1);
  unavailableClk1.tick(100);
  assert.equal(unavailableClk1.status().locked, false);
  assert.equal(unavailableClk1.status().referenceSource, 'clk1');
  const availableClk1 = new Rt1062ArmPll({ reference24MAvailable: false, referenceClk1Available: true });
  configure(availableClk1, 88, 1);
  availableClk1.tick();
  assert.equal(availableClk1.status().locked, true);
});

test('reserved source codes remain stored and visible while conservatively holding LOCK low', () => {
  const pll = ready({ referenceClk1Available: true });
  for (const source of [2, 3]) {
    configure(pll, 88, source);
    pll.tick(0xffffffff);
    assert.equal(pll.status().referenceSourceCode, source);
    assert.equal(pll.status().referenceSource, 'unsupported');
    assert.equal(pll.status().referenceAvailable, false);
    assert.equal(pll.status().locked, false);
    assert.ok(pll.status().unsupported.some(value => /BYPASS_CLK_SRC/.test(value)));
    assert.equal(pll.status().lockElapsed, 0);
  }
  configure(pll);
  assert.equal(pll.status().locked, false);
  pll.tick();
  assert.equal(pll.status().locked, true);
  assert.deepEqual(pll.status().unsupported, []);
});

test('all 128 divider encodings are retained and only documented54..108 can lock', () => {
  const pll = new Rt1062ArmPll();
  for (let divider = 0; divider <= 127; divider++) {
    configure(pll, divider);
    pll.tick();
    assert.equal(pll.status().divider, divider);
    const admitted = divider >= 54 && divider <= 108;
    assert.equal(pll.status().locked, admitted, `divider${divider}`);
    assert.equal(pll.status().unsupported.length > 0, !admitted);
  }
});

test('fixed lock failure never completes and survives reset', () => {
  const pll = new Rt1062ArmPll({ lockFailure: true });
  configure(pll);
  pll.tick(0xffffffff);
  assert.equal(pll.status().locked, false);
  assert.equal(pll.status().lockElapsed, 0);
  assert.ok(pll.status().blockingReasons.some(value => /lock-failure/.test(value)));
  pll.reset();
  configure(pll);
  pll.tick(100);
  assert.equal(pll.status().locked, false);
});

test('every SET CLR TOG alias reads zero at each aligned lane', () => {
  const pll = ready();
  assert.notEqual(pll.read(R.CONTROL), 0);
  for (const base of [R.SET, R.CLR, R.TOG]) {
    for (const width of [1, 2, 4]) {
      for (let lane = 0; lane < 4; lane += width) assert.equal(pll.read(base + lane, width), 0);
    }
  }
});

test('SET CLR TOG modify selected ones only and zeros leave state unchanged', () => {
  const pll = new Rt1062ArmPll();
  pll.write(R.CLR, 0x1000);
  assert.equal(pll.read(R.CONTROL), 0x12063);
  pll.write(R.CLR, 0x63);
  pll.write(R.SET, 0x58);
  assert.equal(pll.read(R.CONTROL), 0x12058);
  pll.write(R.TOG, 0x10);
  assert.equal(pll.read(R.CONTROL), 0x12048);
  const before = pll.status();
  for (const base of [R.SET, R.CLR, R.TOG]) pll.write(base, 0);
  assert.deepEqual(pll.status(), before);
});

test('primary and alias byte/halfword writes preserve untouched lanes', () => {
  const pll = ready({ referenceClk1Available: true });
  pll.write(R.CONTROL + 1, 0x61, 1);
  assert.equal(pll.read(R.CONTROL), 0x16058);
  assert.equal(pll.status().referenceSourceCode, 1);
  pll.tick();
  assert.equal(pll.read(R.CONTROL), 0x80016058);
  pll.write(R.CLR + 2, 1, 1);
  assert.equal(pll.status().bypassed, false);
  assert.equal(pll.status().locked, true);
  pll.write(R.CONTROL, 0x2042, 2);
  assert.equal(pll.status().divider, 66);
  assert.equal(pll.status().referenceSourceCode, 0);
  assert.equal(pll.status().locked, false);
  pll.tick();
  assert.equal(pll.read(R.CONTROL + 2, 2), 0x8000);
  assert.equal(pll.read(R.CONTROL + 1, 1), 0x20);
});

test('unwritten high value bits cannot power down select a reference or request a reserved selector', () => {
  const pll = ready();
  const before = pll.status();
  pll.write(R.SET, 0x810c1000, 1);
  pll.write(R.TOG, 0x80090000, 2);
  assert.deepEqual(pll.status(), before);
  pll.write(R.CLR + 3, 0x80000000, 1);
  assert.deepEqual(pll.status(), before);
});

test('LOCK is protected through primary and alias full and narrow writes', () => {
  for (const base of [R.SET, R.CLR, R.TOG]) {
    const pll = ready();
    pll.write(base, 0x80000000);
    pll.write(base + 3, 0x80, 1);
    pll.write(base + 2, 0x8000, 2);
    assert.equal(pll.status().locked, true);
    assert.equal(pll.read(R.CONTROL) >>> 31, 1);
    const fresh = new Rt1062ArmPll();
    fresh.write(base, 0x80000000);
    assert.equal(fresh.status().locked, false);
  }
  const pll = ready();
  pll.write(R.CONTROL, pll.read(R.CONTROL) & 0x7fffffff);
  pll.write(R.CONTROL + 3, 0, 1);
  pll.write(R.CONTROL + 2, 1, 2);
  assert.equal(pll.status().locked, true);
  const fresh = new Rt1062ArmPll();
  fresh.write(R.CONTROL, fresh.read(R.CONTROL) | 0x80000000);
  assert.equal(fresh.status().locked, false);
});

test('reserved PLL_SEL writes stay zero, remain visible and cannot disturb valid lock', () => {
  const pll = ready({ lockTicks: 3 });
  for (const base of [R.SET, R.CLR, R.TOG]) pll.write(base, 0x80000);
  pll.write(R.CONTROL, pll.read(R.CONTROL) | 0x80000);
  assert.equal(pll.status().reservedSelectorRequests, 4);
  assert.equal(pll.read(R.CONTROL) & 0x80000, 0);
  assert.equal(pll.status().locked, true);
  assert.ok(pll.status().unsupported.some(value => /PLL_SEL/.test(value)));
  assert.deepEqual(pll.status().blockingReasons, []);
  const pending = new Rt1062ArmPll({ lockTicks: 3 });
  configure(pending); pending.tick(2);
  pending.write(R.SET + 2, 8, 1);
  assert.equal(pending.status().lockElapsed, 2);
  pending.tick();
  assert.equal(pending.status().locked, true);
});

test('configuration mask excludes LOCK and all reserved bits without losing actual fields', () => {
  const pll = new Rt1062ArmPll();
  pll.write(R.CONTROL, 0xffffffff);
  assert.equal(pll.read(R.CONTROL), 0x1f07f);
  assert.equal(pll.status().reservedSelectorRequests, 1);
  pll.write(R.CONTROL, 0);
  assert.equal(pll.read(R.CONTROL), 0);
  pll.write(R.SET, 0xffe60f80);
  assert.equal(pll.read(R.CONTROL), 0);
});

test('equivalent batched ticks preserve pending and completed states', () => {
  const whole = new Rt1062ArmPll({ lockTicks: 7 }), split = new Rt1062ArmPll({ lockTicks: 7 });
  configure(whole); configure(split);
  whole.tick(6);
  for (const count of [2, 0, 3, 1]) split.tick(count);
  assert.deepEqual(whole.status(), split.status());
  whole.tick(10); split.tick(5); split.tick(5);
  assert.deepEqual(whole.status(), split.status());
  assert.equal(whole.status().lockElapsed, 7);
  assert.equal(whole.status().ticks, 16);
});

test('zero-delay lock still needs an explicit tick after eligible power-up', () => {
  const pll = new Rt1062ArmPll({ lockTicks: 0 });
  pll.tick(0);
  assert.equal(pll.status().locked, false);
  configure(pll);
  pll.read(R.CONTROL);
  assert.equal(pll.status().locked, false);
  pll.tick(0);
  assert.equal(pll.status().locked, true);
  configure(pll, 96);
  assert.equal(pll.status().locked, false);
  pll.tick(0);
  assert.equal(pll.status().locked, true);
});

test('tick bounds reject invalid delays and counts without mutating model state', () => {
  const pll = new Rt1062ArmPll({ lockTicks: 0xffffffff });
  configure(pll);
  pll.tick(0xfffffffe);
  assert.equal(pll.status().locked, false);
  const before = pll.status();
  for (const count of [-1, 0.5, NaN, Infinity, 0x100000000, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => pll.tick(count), RangeError);
    assert.throws(() => new Rt1062ArmPll({ lockTicks: count }), RangeError);
    assert.deepEqual(pll.status(), before);
  }
  pll.tick();
  assert.equal(pll.status().locked, true);
});

test('boolean fixtures are validated and status returns independent diagnostic copies', () => {
  for (const name of ['lockFailure', 'reference24MAvailable', 'referenceClk1Available']) {
    for (const value of [0, 1, null, 'false']) assert.throws(() => new Rt1062ArmPll({ [name]: value }), TypeError);
  }
  const pll = ready();
  const snapshot = pll.status();
  snapshot.configuration.lockFailure = true;
  snapshot.configuration.lockTicks = 0;
  snapshot.blockingReasons.push('invented'); snapshot.unsupported.push('invented');
  assert.equal(pll.status().configuration.lockFailure, false);
  assert.equal(pll.status().configuration.lockTicks, 1);
  assert.deepEqual(pll.status().blockingReasons, []);
  assert.deepEqual(pll.status().unsupported, []);
  assert.ok(Object.isFrozen(pll.status().limitations));
});

test('reset restores source controls and clears progress while retaining fixed reference fixtures', () => {
  const options = { lockTicks: 4, lockFailure: false, reference24MAvailable: false, referenceClk1Available: true };
  const pll = new Rt1062ArmPll(options);
  configure(pll, 100, 1); pll.tick(4); pll.write(R.SET, 0x80000);
  pll.reset();
  assert.equal(pll.read(R.CONTROL), 0x13063);
  assert.equal(pll.status().locked, false);
  assert.equal(pll.status().lockElapsed, 0);
  assert.equal(pll.status().ticks, 0);
  assert.equal(pll.status().reservedSelectorRequests, 0);
  assert.deepEqual(pll.status().configuration, options);
  pll.write(R.CLR, 0x1000); pll.tick(100);
  assert.equal(pll.status().locked, false);
  configure(pll, 88, 1); pll.tick(4);
  assert.equal(pll.status().locked, true);
});

test('exact16-byte ownership leaves USB1 other PLLs PFD and handshakes unhandled', () => {
  const pll = new Rt1062ArmPll();
  for (const base of Object.values(R)) {
    for (const width of [1, 2, 4]) {
      for (let lane = 0; lane < 4; lane += width) assert.equal(pll.handles(base + lane, width), true);
    }
  }
  const before = pll.status();
  for (const address of [R.CONTROL - 4, R.TOG + 4, 0x400d8020, 0x400d8030, 0x400d8070,
    0x400d80a0, 0x400d80e0, 0x400d80f0, 0x400d8100, 0x400fc048]) {
    assert.equal(pll.handles(address), false);
    assert.equal(pll.read(address), undefined);
    assert.equal(pll.write(address, 0xffffffff), false);
  }
  assert.deepEqual(pll.status(), before);
});

test('malformed widths addresses and cross-lane accesses remain unhandled', () => {
  const pll = new Rt1062ArmPll();
  const before = pll.status();
  for (const [address, width] of [[R.CONTROL, 3], [R.CONTROL, 8], [R.CONTROL + 1, 2],
    [R.CONTROL + 1, 4], [R.TOG + 3, 2], [R.CONTROL + 0.5, 1], [-1, 1],
    [NaN, 4], [Infinity, 4], [0x1400d8000, 4]]) {
    assert.equal(pll.handles(address, width), false);
    assert.equal(pll.read(address, width), undefined);
    assert.equal(pll.write(address, 0xffffffff, width), false);
  }
  assert.deepEqual(pll.status(), before);
});
