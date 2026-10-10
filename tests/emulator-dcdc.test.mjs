import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Rt1062Dcdc, DCDC_REG as R, DCDC_BITS as B, DCDC_RESET,
  DCDC_WRITABLE, DCDC_EVIDENCE, DCDC_LIMITATIONS,
} from '../src/lib/emulator/dcdc.ts';

function ready(options) {
  const dcdc = new Rt1062Dcdc(options);
  dcdc.tick(dcdc.status().configuration.settleTicks);
  assert.equal(dcdc.status().dcOk, true);
  return dcdc;
}
function target(dcdc, run, low = dcdc.status().targetLowPower) {
  dcdc.write(R.REG3, (dcdc.read(R.REG3) & ~0x71f) | run | (low << 8));
}

test('evidence pins the reviewed RT1062 source and discloses synthetic readiness', () => {
  assert.match(DCDC_EVIDENCE.driver, /6f3fd257cdcf978a4d26e7d6e9eed9240037422b\/drivers\/dcdc_1\/fsl_dcdc.c$/);
  for (const name of ['manualSha256', 'headerSha256', 'driverSha256']) {
    assert.match(DCDC_EVIDENCE[name], /^[a-f0-9]{64}$/);
  }
  assert.ok(DCDC_LIMITATIONS.some(value => /synthetic ticks/.test(value)));
  assert.ok(DCDC_LIMITATIONS.some(value => /IRQ/.test(value)));
});

test('manual resets preserve nonzero reserved lanes and leave DC_OK low', () => {
  const dcdc = new Rt1062Dcdc();
  assert.deepEqual(DCDC_RESET, { REG0: 0x14030111, REG1: 0x111ba29c, REG2: 2, REG3: 0x10e });
  assert.deepEqual([dcdc.read(R.REG0), dcdc.read(R.REG1), dcdc.read(R.REG2), dcdc.read(R.REG3)],
    [0x14030111, 0x111ba29c, 2, 0x10e]);
  assert.equal(dcdc.status().dcOk, false);
  assert.equal(dcdc.status().targetRun, 14);
  assert.equal(dcdc.status().targetLowPower, 1);
  assert.equal(dcdc.status().clockSource, 'internal');
});

test('all documented field masks retain the source values', () => {
  assert.deepEqual(DCDC_WRITABLE, { REG0: 0x3c3f0fff, REG1: 0x1fa03380, REG2: 0x18003fc0, REG3: 0x4100071f });
  const dcdc = new Rt1062Dcdc();
  for (const name of ['REG0', 'REG1', 'REG2', 'REG3']) dcdc.write(R[name], 0xffffffff);
  assert.deepEqual([dcdc.read(R.REG0), dcdc.read(R.REG1), dcdc.read(R.REG2), dcdc.read(R.REG3)],
    [0x3c3f0fff, 0x1fbbb39c, 0x18003fc2, 0x4100071f]);
  assert.equal(dcdc.read(R.REG0) >>> 31, 0);
  for (const name of ['REG0', 'REG1', 'REG2', 'REG3']) dcdc.write(R[name], 0);
  assert.deepEqual([dcdc.read(R.REG0), dcdc.read(R.REG1), dcdc.read(R.REG2), dcdc.read(R.REG3)],
    [0, 0x001b801c, 2, 0]);
});

test('adjacent words are separate registers and do not perform SET CLR or TOG', () => {
  const dcdc = new Rt1062Dcdc();
  const before = dcdc.read(R.REG0);
  dcdc.write(R.REG0 + 4, 0x1f000000);
  dcdc.write(R.REG0 + 8, 0x18000000);
  dcdc.write(R.REG0 + 12, 0x13);
  assert.equal(dcdc.read(R.REG0), before);
  assert.equal(dcdc.read(R.REG1), 0x1f1b801c);
  assert.equal(dcdc.read(R.REG2), 0x18000002);
  assert.equal(dcdc.read(R.REG3), 0x13);
  assert.equal(dcdc.handles(R.REG0 + 16), false);
});

test('reads and unchanged writes never advance or complete settling', () => {
  const dcdc = new Rt1062Dcdc({ settleTicks: 3 });
  target(dcdc, 0x13);
  const before = dcdc.status();
  for (let i = 0; i < 200; i++) {
    for (const address of Object.values(R)) dcdc.write(address, dcdc.read(address));
    dcdc.read(R.REG0 + 3, 1);
  }
  assert.deepEqual(dcdc.status(), before);
  assert.equal(dcdc.read(R.REG0) & B.STS_DC_OK, 0);
});

test('target adjustment reaches protected DC_OK only at the configured explicit tick', () => {
  const dcdc = ready({ settleTicks: 3 });
  target(dcdc, 0x13);
  assert.equal(dcdc.status().dcOk, false);
  assert.equal(dcdc.status().settlingElapsed, 0);
  dcdc.tick(2);
  assert.equal(dcdc.read(R.REG0) >>> 31, 0);
  dcdc.tick();
  assert.equal(dcdc.read(R.REG0) >>> 31, 1);
  assert.equal(dcdc.status().targetRun, 0x13);
  assert.equal(dcdc.read(R.REG3), 0x113);
});

test('a second changed target restarts pending settling without stale readiness', () => {
  const dcdc = ready({ settleTicks: 4 });
  target(dcdc, 19);
  dcdc.tick(3);
  target(dcdc, 17);
  dcdc.tick(3);
  assert.equal(dcdc.status().dcOk, false);
  assert.equal(dcdc.status().settlingElapsed, 3);
  dcdc.tick();
  assert.equal(dcdc.status().dcOk, true);
  target(dcdc, 19);
  assert.equal(dcdc.status().dcOk, false);
});

test('rewriting unchanged targets preserves pending progress and completed DC_OK', () => {
  const dcdc = new Rt1062Dcdc({ settleTicks: 4 });
  target(dcdc, 19);
  dcdc.tick(3);
  target(dcdc, 19);
  assert.equal(dcdc.status().settlingElapsed, 3);
  dcdc.tick();
  const before = dcdc.status();
  target(dcdc, 19);
  assert.deepEqual(dcdc.status(), before);
});

test('the NXP one-output adjustment sequence preserves fields and restarts target settling', () => {
  const dcdc = ready({ settleTicks: 2 });
  dcdc.write(R.REG3, dcdc.read(R.REG3) | B.DISABLE_STEP | 0x01000000);
  assert.equal(dcdc.status().dcOk, true);
  // Independent MMIO caller follows the one-output driver RMW sequence.
  dcdc.write(R.REG3, dcdc.read(R.REG3) & ~0x40000000);
  dcdc.write(R.REG3, (dcdc.read(R.REG3) & ~0x71f) | (4 << 8) | 19);
  assert.equal(dcdc.read(R.REG3), 0x01000413);
  assert.equal(dcdc.read(R.REG0) & 0x80000000, 0);
  dcdc.tick();
  assert.equal(dcdc.read(R.REG0) & 0x80000000, 0);
  dcdc.tick();
  assert.equal(dcdc.read(R.REG0) >>> 31, 1);
});

test('DISABLE_STEP retains configuration while admitting target writes', () => {
  const dcdc = ready({ settleTicks: 2 });
  dcdc.write(R.REG3, dcdc.read(R.REG3) | 0x40000000);
  target(dcdc, 31);
  assert.equal(dcdc.status().targetRun, 31);
  assert.equal(dcdc.status().dcOk, false);
  assert.equal(dcdc.read(R.REG3) & 0x40000000, 0x40000000);
  dcdc.tick(2);
  assert.equal(dcdc.status().dcOk, true);
});

test('all 32 documented TRG encodings remain admitted', () => {
  const dcdc = ready();
  for (let run = 0; run <= 31; run++) {
    target(dcdc, run);
    dcdc.tick();
    assert.equal(dcdc.status().targetRun, run);
    assert.equal(dcdc.status().dcOk, true);
    assert.deepEqual(dcdc.status().unsupported, []);
  }
});

test('a low-power target change restarts status while all documented codes settle', () => {
  const dcdc = ready({ settleTicks: 2 });
  for (const low of [0, 1, 2, 3, 4]) {
    target(dcdc, 19, low);
    assert.equal(dcdc.status().dcOk, false);
    dcdc.tick(2);
    assert.equal(dcdc.status().dcOk, true);
    assert.equal(dcdc.status().targetLowPower, low);
  }
});

test('undocumented low-power targets are retained, visible and conservatively stalled', () => {
  const dcdc = ready();
  for (const low of [5, 6, 7]) {
    target(dcdc, 19, low);
    dcdc.tick(0xffffffff);
    assert.equal(dcdc.status().targetLowPower, low);
    assert.equal(dcdc.status().dcOk, false);
    assert.ok(dcdc.status().unsupported.some(value => /TARGET_LP/.test(value)));
    assert.ok(dcdc.status().blockingReasons.some(value => /TARGET_LP/.test(value)));
    assert.equal(dcdc.status().settlingElapsed, 0);
  }
  target(dcdc, 19, 4);
  assert.equal(dcdc.status().dcOk, false);
  dcdc.tick();
  assert.equal(dcdc.status().dcOk, true);
  assert.deepEqual(dcdc.status().unsupported, []);
});

test('CUR_SNS reserved codes are visible without inventing current-detector behavior', () => {
  const dcdc = ready();
  dcdc.write(R.REG0, (dcdc.read(R.REG0) & ~0xe0) | (6 << 5));
  assert.ok(dcdc.status().unsupported.some(value => /CUR_SNS_THRSH/.test(value)));
  assert.equal(dcdc.status().dcOk, true);
  dcdc.write(R.REG0, (dcdc.read(R.REG0) & ~0xe0) | (5 << 5));
  assert.deepEqual(dcdc.status().unsupported, []);
});

test('DC_OK cannot be software-written or cleared as W1C in any byte lane', () => {
  const fresh = new Rt1062Dcdc();
  fresh.write(R.REG0, fresh.read(R.REG0) | 0x80000000);
  fresh.write(R.REG0 + 3, 0x80, 1);
  fresh.write(R.REG0 + 2, 0x8000, 2);
  assert.equal(fresh.status().dcOk, false);
  const dcdc = ready();
  dcdc.write(R.REG0 + 3, dcdc.read(R.REG0 + 3, 1) & 0x7f, 1);
  assert.equal(dcdc.status().dcOk, true);
  dcdc.write(R.REG0, dcdc.read(R.REG0));
  assert.equal(dcdc.status().dcOk, true);
  assert.equal(dcdc.read(R.REG0) >>> 31, 1);
});

test('byte and halfword writes preserve the other defined and reserved lanes', () => {
  const dcdc = new Rt1062Dcdc();
  dcdc.write(R.REG1 + 3, 0x1e, 1);
  assert.equal(dcdc.read(R.REG1), 0x1e1ba29c);
  dcdc.write(R.REG1, 0x3300, 2);
  assert.equal(dcdc.read(R.REG1), 0x1e1bb31c);
  assert.equal(dcdc.read(R.REG1 + 1, 1), 0xb3);
  assert.equal(dcdc.read(R.REG1 + 2, 2), 0x1e1b);
  dcdc.write(R.REG3 + 1, 4, 1);
  assert.equal(dcdc.read(R.REG3), 0x40e);
  dcdc.write(R.REG3 + 2, 0x4100, 2);
  assert.equal(dcdc.read(R.REG3), 0x4100040e);
  assert.equal(dcdc.status().targetLowPower, 4);
});

test('unwritten high value bits cannot change clock selection or DISABLE_STEP', () => {
  const dcdc = ready();
  const before = dcdc.status();
  dcdc.write(R.REG0 + 3, 0x20000000, 1);
  assert.equal(dcdc.read(R.REG0) & 0x20000000, 0);
  assert.equal(dcdc.status().clockSource, 'internal');
  dcdc.write(R.REG3, 0x4000000e, 1);
  assert.equal(dcdc.read(R.REG3) & 0x40000000, 0);
  assert.equal(dcdc.status().dcOk, true);
  assert.equal(dcdc.status().ticks, before.ticks);
});

test('fixed settling failure and disabled converter never fabricate DC_OK', () => {
  for (const options of [{ settlingFailure: true }, { converterEnabled: false }]) {
    const dcdc = new Rt1062Dcdc(options);
    target(dcdc, 19);
    dcdc.tick(0xffffffff);
    assert.equal(dcdc.read(R.REG0) >>> 31, 0);
    assert.equal(dcdc.status().settlingElapsed, 0);
    assert.equal(dcdc.status().blockingReasons.length, 1);
    dcdc.reset();
    dcdc.tick(100);
    assert.equal(dcdc.status().dcOk, false);
  }
});

test('forced internal selection requires its explicit availability and powered oscillator', () => {
  for (const options of [{ internalClockAvailable: false }, {}]) {
    const dcdc = new Rt1062Dcdc(options);
    dcdc.write(R.REG0, (dcdc.read(R.REG0) | 2 | 8) & ~4);
    dcdc.tick(100);
    assert.equal(dcdc.status().clockSource, 'unavailable');
    assert.equal(dcdc.status().dcOk, false);
    dcdc.write(R.REG0, dcdc.read(R.REG0) & ~8);
    dcdc.tick();
    assert.equal(dcdc.status().dcOk, options.internalClockAvailable !== false);
  }
});

test('forced external selection needs an explicit source fixture despite writable XTAL controls', () => {
  const unavailable = ready();
  unavailable.write(R.REG0, unavailable.read(R.REG0) | 0x2800000e);
  unavailable.tick(100);
  assert.equal(unavailable.status().clockSource, 'unavailable');
  assert.equal(unavailable.status().dcOk, false);
  assert.equal(unavailable.read(R.REG0) & 0x28000000, 0x28000000);
  const available = new Rt1062Dcdc({ externalClockAvailable: true });
  available.write(R.REG0, available.read(R.REG0) | 0xe);
  available.tick();
  assert.equal(available.status().clockSource, 'external');
  assert.equal(available.status().dcOk, true);
});

test('auto selection uses only available fixture clocks and discloses its fallback policy', () => {
  const internal = ready();
  internal.write(R.REG0, internal.read(R.REG0) | 0x20000000);
  assert.equal(internal.status().clockSource, 'internal');
  assert.equal(internal.status().dcOk, true);
  internal.write(R.REG0, internal.read(R.REG0) | 8);
  internal.tick(100);
  assert.equal(internal.status().clockSource, 'unavailable');
  assert.equal(internal.status().dcOk, false);
  const external = ready({ externalClockAvailable: true });
  external.write(R.REG0, external.read(R.REG0) | 0x20000000);
  assert.equal(external.status().clockSource, 'external');
  assert.equal(external.status().dcOk, false);
  external.tick();
  assert.equal(external.status().dcOk, true);
});

test('changing the selected available clock restarts the explicit settling delay', () => {
  const dcdc = ready({ externalClockAvailable: true, settleTicks: 3 });
  dcdc.write(R.REG0, dcdc.read(R.REG0) | 6);
  assert.equal(dcdc.status().dcOk, false);
  dcdc.tick(2);
  assert.equal(dcdc.status().dcOk, false);
  dcdc.tick();
  assert.equal(dcdc.status().dcOk, true);
  dcdc.write(R.REG0, dcdc.read(R.REG0) & ~4);
  assert.equal(dcdc.status().clockSource, 'internal');
  assert.equal(dcdc.status().settlingElapsed, 0);
});

test('configuration controls retain values without resetting unrelated target progress', () => {
  const dcdc = new Rt1062Dcdc({ settleTicks: 5 });
  dcdc.tick(3);
  // NXP DCM helper uses RCSCALE5; the manual recommends4, and both fit the field.
  dcdc.write(R.REG0, dcdc.read(R.REG0) & ~(1 | 0x04000000));
  dcdc.write(R.REG2, (dcdc.read(R.REG2) & ~0xe00) | (5 << 9) | 0x10000000);
  dcdc.write(R.REG1, dcdc.read(R.REG1) & ~0x200);
  assert.equal(dcdc.status().settlingElapsed, 3);
  assert.equal(dcdc.read(R.REG2), 0x10000a02);
  assert.equal(dcdc.read(R.REG1), 0x111ba09c);
  dcdc.tick(2);
  assert.equal(dcdc.status().dcOk, true);
  dcdc.write(R.REG0, dcdc.read(R.REG0) | 0x10000000);
  dcdc.tick(100);
  assert.equal(dcdc.read(R.REG0) & 0x10000000, 0x10000000);
});

test('tick batching has the same complete and pending state as smaller ticks', () => {
  const whole = new Rt1062Dcdc({ settleTicks: 7 }), split = new Rt1062Dcdc({ settleTicks: 7 });
  target(whole, 19); target(split, 19);
  whole.tick(6);
  for (const ticks of [1, 2, 0, 3]) split.tick(ticks);
  assert.deepEqual(whole.status(), split.status());
  whole.tick(10); split.tick(4); split.tick(6);
  assert.deepEqual(whole.status(), split.status());
  assert.equal(whole.status().settlingElapsed, 7);
  assert.equal(whole.status().ticks, 16);
});

test('zero-duration settling still requires an explicit tick including tick zero', () => {
  const dcdc = new Rt1062Dcdc({ settleTicks: 0 });
  assert.equal(dcdc.status().dcOk, false);
  dcdc.read(R.REG0);
  assert.equal(dcdc.status().dcOk, false);
  dcdc.tick(0);
  assert.equal(dcdc.status().dcOk, true);
  target(dcdc, 19);
  assert.equal(dcdc.status().dcOk, false);
  dcdc.tick(0);
  assert.equal(dcdc.status().dcOk, true);
  assert.equal(dcdc.status().ticks, 0);
});

test('bounded tick validation leaves state unchanged on invalid inputs', () => {
  const dcdc = new Rt1062Dcdc({ settleTicks: 0xffffffff });
  dcdc.tick(0xfffffffe);
  assert.equal(dcdc.status().dcOk, false);
  const before = dcdc.status();
  for (const count of [-1, 1.5, NaN, Infinity, 0x100000000, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => dcdc.tick(count), RangeError);
    assert.deepEqual(dcdc.status(), before);
    assert.throws(() => new Rt1062Dcdc({ settleTicks: count }), RangeError);
  }
  dcdc.tick();
  assert.equal(dcdc.status().dcOk, true);
});

test('fixture values require booleans and snapshots cannot mutate the configuration', () => {
  for (const name of ['settlingFailure', 'converterEnabled', 'internalClockAvailable', 'externalClockAvailable']) {
    for (const value of [0, 1, null, 'false']) assert.throws(() => new Rt1062Dcdc({ [name]: value }), TypeError);
  }
  const dcdc = new Rt1062Dcdc();
  const snapshot = dcdc.status();
  snapshot.configuration.settleTicks = 0;
  snapshot.configuration.settlingFailure = true;
  snapshot.unsupported.push('invented');
  snapshot.blockingReasons.push('invented');
  assert.equal(dcdc.status().configuration.settleTicks, 1);
  assert.deepEqual(dcdc.status().unsupported, []);
  assert.deepEqual(dcdc.status().blockingReasons, []);
  assert.ok(Object.isFrozen(dcdc.status().limitations));
});

test('reset restores source registers and time while retaining fixed environment fixtures', () => {
  const options = { settleTicks: 4, settlingFailure: true, converterEnabled: false,
    internalClockAvailable: false, externalClockAvailable: true };
  const dcdc = new Rt1062Dcdc(options);
  dcdc.write(R.REG0, 6);
  target(dcdc, 31, 4);
  dcdc.tick(500);
  dcdc.reset();
  assert.deepEqual([dcdc.read(R.REG0), dcdc.read(R.REG1), dcdc.read(R.REG2), dcdc.read(R.REG3)],
    [0x14030111, 0x111ba29c, 2, 0x10e]);
  assert.deepEqual(dcdc.status().configuration, options);
  assert.equal(dcdc.status().ticks, 0);
  assert.equal(dcdc.status().settlingElapsed, 0);
  assert.equal(dcdc.status().dcOk, false);
});

test('all exact register lanes are owned and neighboring or malformed accesses remain unhandled', () => {
  const dcdc = new Rt1062Dcdc();
  for (const base of Object.values(R)) {
    for (const width of [1, 2, 4]) {
      for (let lane = 0; lane < 4; lane += width) {
        assert.equal(dcdc.handles(base + lane, width), true);
        assert.equal(typeof dcdc.read(base + lane, width), 'number');
      }
    }
  }
  const before = dcdc.status();
  for (const [address, width] of [[R.REG0 - 4, 4], [R.REG3 + 4, 4], [R.REG3 + 3, 2],
    [R.REG0 + 1, 4], [R.REG0 + 1, 2], [R.REG0, 3], [R.REG0, 8],
    [NaN, 4], [Infinity, 4], [-1, 1], [0x140080000, 4], [R.REG0 + 0.5, 1]]) {
    assert.equal(dcdc.handles(address, width), false);
    assert.equal(dcdc.read(address, width), undefined);
    assert.equal(dcdc.write(address, 0xffffffff, width), false);
  }
  assert.deepEqual(dcdc.status(), before);
});
