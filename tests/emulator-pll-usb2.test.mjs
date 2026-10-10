import assert from 'node:assert/strict';
import test from 'node:test';
import {Rt1062Usb2Pll, PLL_USB2_REG as R} from '../src/lib/emulator/pll-usb2.ts';

test('reset USB2 controls retain output/bypass with analog power off and no lock', () => {
  const pll = new Rt1062Usb2Pll();
  assert.equal(pll.read(R.CONTROL), 0x12000);
  pll.tick(0xffffffff);
  assert.equal(pll.read(R.CONTROL), 0x12000);
  assert.equal(pll.status().powered, false);
});
test('NXP USB2 initializer waits while bypassed then selects locked output', () => {
  for (const divider of [0, 2]) {
    const pll = new Rt1062Usb2Pll({lockTicks: 3});
    // fsl_clock.c689..705: source/bypass, configure/power/PHY phases, poll, unbypass.
    pll.write(R.CONTROL, (pll.read(R.CONTROL) & ~0xc000) | 0x10000);
    pll.write(R.CONTROL, (pll.read(R.CONTROL) & ~2) | 0x2000 | 0x1000 | 0x40 | divider);
    assert.equal(pll.read(R.CONTROL), 0x13040 | divider);
    pll.tick(2); assert.equal(pll.read(R.CONTROL) >>> 31, 0);
    pll.tick(1); assert.equal(pll.read(R.CONTROL) >>> 31, 1);
    pll.write(R.CONTROL, pll.read(R.CONTROL) & ~0x10000);
    assert.equal(pll.status().bypassed, false);
    assert.equal(pll.status().multiplier, divider ? 22 : 20);
    assert.equal(pll.status().usbClocksEnabled, true);
    assert.equal(pll.status().locked, true);
  }
});
test('POWER has USB polarity and TOG powers off without trusting read-only LOCK', () => {
  const pll = new Rt1062Usb2Pll();
  pll.write(R.SET, 0x1000); pll.tick();
  assert.equal(pll.read(R.CONTROL), 0x80013000);
  pll.write(R.TOG, 0x1000 | 0x80000000); pll.tick();
  assert.equal(pll.read(R.CONTROL), 0x12000);
});
test('output gates and bypass do not prevent analog lock or disturb progress', () => {
  const pll = new Rt1062Usb2Pll({lockTicks: 3});
  pll.write(R.CONTROL, 0x1000); pll.tick(2);
  pll.write(R.SET, 0x12040); pll.tick(1);
  assert.equal(pll.status().locked, true);
  pll.write(R.CLR, 0x12040);
  assert.equal(pll.read(R.CONTROL), 0x80001000);
});
test('same configuration preserves delay but power divider and reference changes restart it', () => {
  const pll = new Rt1062Usb2Pll({lockTicks: 3, referenceClk1Available: true});
  pll.write(R.SET, 0x1000); pll.tick(2);
  pll.write(R.CONTROL, pll.read(R.CONTROL));
  assert.equal(pll.status().lockElapsed, 2);
  pll.write(R.SET, 2); assert.equal(pll.status().lockElapsed, 0);
  pll.tick(3); assert.equal(pll.status().locked, true);
  pll.write(R.SET, 0x4000); assert.equal(pll.status().locked, false);
  pll.tick(3); assert.equal(pll.status().locked, true);
  pll.write(R.CLR, 0x1000); assert.equal(pll.status().lockElapsed, 0);
});
test('source availability is explicit and reserved selectors remain visible without lock', () => {
  for (let source = 0; source < 4; source++) for (const available of [false, true]) {
    const pll = new Rt1062Usb2Pll({reference24MAvailable: available, referenceClk1Available: available});
    pll.write(R.CONTROL, 0x1000 | (source << 14)); pll.tick(100);
    assert.equal(pll.status().referenceSourceCode, source);
    assert.equal(pll.status().locked, source < 2 && available);
    assert.equal(pll.status().referenceAvailable, source < 2 && available);
    if (source > 1) assert.ok(pll.status().blockingReasons.includes('unsupported reference source encoding'));
  }
});
test('fixed failures and unavailable references survive reset without synthesized power', () => {
  for (const options of [{lockFailure: true}, {reference24MAvailable: false}]) {
    const pll = new Rt1062Usb2Pll(options);
    for (let round = 0; round < 2; round++) {
      pll.write(R.SET, 0x1000); pll.tick(50); assert.equal(pll.status().locked, false);
      pll.reset(); assert.equal(pll.read(R.CONTROL), 0x12000); assert.equal(pll.status().ticks, 0);
    }
  }
});
test('all alias reads are zero and byte operations preserve independent lanes', () => {
  const pll = new Rt1062Usb2Pll();
  for (const alias of [R.SET, R.CLR, R.TOG]) for (const width of [1, 2, 4]) {
    for (let offset = 0; offset < 4; offset += width) assert.equal(pll.read(alias + offset, width), 0);
  }
  pll.write(R.SET, 0x40, 1); pll.write(R.SET + 1, 0x10, 1);
  assert.equal(pll.read(R.CONTROL), 0x13040);
  pll.write(R.CLR + 2, 1, 1); assert.equal(pll.read(R.CONTROL), 0x3040);
  pll.write(R.TOG, 2, 2); assert.equal(pll.read(R.CONTROL), 0x3042);
  pll.write(R.CONTROL, 0, 1); assert.equal(pll.read(R.CONTROL), 0x3000);
});
test('read-only LOCK and reserved bits cannot be written through any alias or bus lane', () => {
  const pll = new Rt1062Usb2Pll();
  for (const address of Object.values(R)) {pll.write(address, 0xffffffff); assert.equal(pll.read(R.CONTROL) >>> 31, 0);}
  pll.write(R.CONTROL, 0x1000); pll.tick();
  for (const address of Object.values(R)) {pll.write(address + 3, 0xff, 1); assert.equal(pll.read(R.CONTROL), 0x80001000);}
  pll.write(R.CONTROL + 2, 0xffff, 2);
  assert.equal(pll.read(R.CONTROL), 0x80011000, 'Only documented BYPASS survives the high lane');
});
test('reads and writes do not advance time; batches and explicit zero delay are deterministic', () => {
  const a = new Rt1062Usb2Pll({lockTicks: 4}), b = new Rt1062Usb2Pll({lockTicks: 4});
  for (const pll of [a, b]) {pll.write(R.SET, 0x1000); for (let i = 0; i < 50; i++) pll.read(R.CONTROL);}
  a.tick(4); b.tick(1); b.tick(3); assert.deepEqual(a.status(), b.status());
  const zero = new Rt1062Usb2Pll({lockTicks: 0}); zero.write(R.SET, 0x1000);
  assert.equal(zero.status().locked, false); zero.tick(0); assert.equal(zero.status().locked, true);
});
test('exact USB2 ownership leaves ARM USB1 SYS and adjacent reserved bytes unhandled', () => {
  const pll = new Rt1062Usb2Pll();
  for (const address of [0x400d8000, 0x400d8010, 0x400d801f, 0x400d8030, 0x400d8040]) {
    assert.equal(pll.handles(address, 1), false); assert.equal(pll.read(address, 1), undefined); assert.equal(pll.write(address, 0, 1), false);
  }
  for (const [address, width] of [[R.CONTROL + 1, 2], [R.TOG + 3, 4], [R.CONTROL, 3], [-1, 1], [NaN, 4], [0x1400d8020, 4]]) {
    assert.equal(pll.read(address, width), undefined); assert.equal(pll.write(address, 0, width), false);
  }
  assert.equal(pll.handles(R.TOG + 3, 1), true);
});
test('invalid ticks fixtures and mutable status copies cannot change the controller', () => {
  for (const value of [-1, 0.5, Infinity, NaN, 0x100000000]) assert.throws(() => new Rt1062Usb2Pll({lockTicks: value}), RangeError);
  for (const name of ['lockFailure', 'reference24MAvailable', 'referenceClk1Available']) assert.throws(() => new Rt1062Usb2Pll({[name]: 1}), TypeError);
  const pll = new Rt1062Usb2Pll(), before = pll.status();
  for (const value of [-1, 0.5, Infinity, NaN, 0x100000000]) assert.throws(() => pll.tick(value), RangeError);
  const status = pll.status(); status.configuration.reference24MAvailable = false; status.blockingReasons.length = 0;
  assert.deepEqual(pll.status(), before);
});
