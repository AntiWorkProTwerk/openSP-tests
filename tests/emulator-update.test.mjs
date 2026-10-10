import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import test from 'node:test';
import {VirtualFirmwareUpdater, VirtualUpdateError, updateCommand, updateCrc32,
  prepareVirtualUpdateCandidate, VIRTUAL_FULL_TARGETS, VIRTUAL_WRITER_PROFILES} from '../src/lib/emulator/update.ts';

// This protocol fake tests host decisions. Executed firmware is exercised by
// tools/test-emulator-update.mjs; these cases establish no ARM or device result.
const statusFields = ['version', 'state', 'error', 'length', 'received', 'crc32', 'maximum',
  'capabilities', 'jedec', 'flash_status', 'flash_error', 'programmed', 'flash_ready', 'flash_crc32', 'build_marker'];
const header = Buffer.from('53464450000101ff00000109300000ffc2000104600000ffffffffffffffffff', 'hex');
const bfpt = Buffer.from('e520f1ffffffff0144eb086b083b04bbeeffffffffff00ffffff00ff0c200f5210d800ff0000000000000000', 'hex');
const markers = {R13: 0x523d0001, R14: 0x523e0001, R15: 0x523f0001, R16B: 0x52410001, R48: 0x52620001};
const recipientHash = name => VIRTUAL_WRITER_PROFILES.find(profile => profile.name === name)?.runningImage?.sha256;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const crc = bytes => {
  let result = 0xffffffff;
  for (const byte of bytes) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0);
  }
  return (result ^ 0xffffffff) >>> 0;
};
function candidate(length = 2048) {
  const bytes = Uint8Array.from({length}, (_, index) => index * 17 & 255);
  if (length >= 0x404) {
    bytes.set(Buffer.from('SPUAFW10'), 0x200);
    const view = new DataView(bytes.buffer);
    for (const [offset, value] of [[0x208, 1], [0x20c, length], [0x210, 0x80000000],
      [0x214, length - 0x400], [0x218, 0x400], [0x21c, 0x20243000], [0x400, 0x20243000]]) view.setUint32(offset, value, true);
  }
  return bytes;
}
const optionsFor = (bytes, marker = markers.R14) => ({expectedSha256: hash(bytes), expectedMarker: marker});
function freshStatus(name, marker) {
  return {signature: name === 'R16B' ? 'SP16' : `SP${name.slice(1)}`, version: 2, state: 0, error: 0, length: 0,
    received: 0, crc32: 0, maximum: name === 'R16B' || name === 'R48' ? 0x37f000 : 65536, capabilities: 1, jedec: 0,
    flash_status: 0, flash_error: 0, programmed: 0, flash_ready: 0, flash_crc32: 0, build_marker: marker};
}
function report(status) {
  const bytes = new Uint8Array(64);
  bytes.set(Buffer.from(status.signature));
  const view = new DataView(bytes.buffer);
  statusFields.forEach((field, index) => view.setUint32(4 + index * 4, status[field], true));
  return Array.from(bytes);
}
function makeFake({running = 'R13', target = 'R14', targetMarker = markers[target], initialMarker = markers[running],
  alter, alterRaw, alterSnapshot, waitProbe = 1, waitFlash = 1, onCommand, resetMode = 'fresh'} = {}) {
  const fake = {commands: [], normalReads: 0, resets: 0, snapshots: [], uploaded: undefined,
    status: freshStatus(running, initialMarker), runningHash: recipientHash(running) ?? hash(Buffer.from(`fake-${running}`))};
  let job, polls = 0, completedGets = 0;
  const emit = kind => {
    const state = {...fake.status};
    alter?.(kind, state, fake);
    const raw = report(state);
    return alterRaw?.(kind, raw, fake) ?? raw;
  };
  const bridge = {
    async transport(request) {
      if (request === undefined) {
        fake.normalReads++;
        let kind = fake.resets ? 'boot' : 'initial';
        if (job === 'probe') {
          kind = 'probe';
          if (++polls >= waitProbe) {Object.assign(fake.status, {jedec: 0xc22016, flash_status: 0x40, flash_ready: 1}); job = undefined;}
        } else if (job === 'flash') {
          kind = 'flash';
          if (++polls > waitFlash) {
            Object.assign(fake.status, {state: 6, programmed: Math.ceil(fake.status.length / 4096) * 4096, flash_crc32: fake.expectedCrc});
            job = undefined; completedGets = 0;
          } else fake.status.state = 5;
        } else if (fake.status.state === 6) kind = ++completedGets ? 'separate' : 'flash';
        return emit(kind);
      }
      assert.equal(request.length, 64);
      assert.equal(request[1], 1); assert.equal(request[3], 0);
      const bytes = Uint8Array.from(request), view = new DataView(bytes.buffer);
      const opcode = bytes[0], argument = view.getUint32(4, true), length = bytes[2];
      fake.commands.push({opcode, argument, length});
      await onCommand?.(opcode, fake);
      switch (opcode) {
        case 5: job = 'probe'; polls = 0; return emit('probe-queued');
        case 7: {
          assert.ok(argument === 0 || argument === 1);
          const diagnostic = new Uint8Array(112);
          diagnostic.set(header); diagnostic.set(bfpt, 32);
          const dv = new DataView(diagnostic.buffer);
          [5, 9, 0x30, 1, 0xc22016, 0x40, 0, 1, 0].forEach((value, index) => dv.setUint32(76 + index * 4, value, true));
          const raw = new Uint8Array(64);
          raw.set(Buffer.from('SPDG')); new DataView(raw.buffer).setUint32(4, argument, true);
          raw.set(diagnostic.subarray(argument * 56, argument * 56 + 56), 8);
          return alterRaw?.(`diagnostics${argument}`, Array.from(raw), fake) ?? Array.from(raw);
        }
        case 1:
          assert.equal(fake.status.state, 0);
          fake.expectedCrc = view.getUint32(8, true); fake.uploaded = new Uint8Array(argument);
          Object.assign(fake.status, {state: 1, length: argument, received: 0, crc32: 0}); return emit('begin');
        case 2:
          assert.equal(argument, fake.status.received); assert.ok(length > 0 && length <= 56);
          fake.uploaded.set(bytes.subarray(8, 8 + length), argument);
          fake.status.received += length; return emit('data');
        case 3:
          assert.equal(fake.status.received, fake.status.length);
          assert.equal(crc(fake.uploaded), fake.expectedCrc);
          Object.assign(fake.status, {state: 2, crc32: crc(fake.uploaded)}); return emit('finish');
        case 6:
          assert.equal(fake.status.state, 2); assert.equal(argument, (fake.expectedCrc ^ 0x46534c48) >>> 0);
          fake.status.state = 4; job = 'flash'; polls = 0; return emit('commit');
        default: assert.fail(`Unexpected command ${opcode}`);
      }
    },
    async reset(contract) {
      fake.resetContract = contract;
      fake.resets++;
      if (resetMode !== 'bus-only') fake.status = freshStatus(target, targetMarker);
      if (resetMode !== 'old-image') fake.runningHash = hash(fake.uploaded);
    },
    async snapshot() {
      const snapshot = {marker: fake.status.build_marker, firmwareState: 2, firmwareHash: fake.runningHash,
        unknownMmio: [], unknownMmioOverflow: 0, cpuBackendFailed: false, fault: undefined, flash: {lastError: ''}};
      alterSnapshot?.(fake.resets ? 'boot' : fake.status.state === 6 ? 'before-reset' : 'before', snapshot, fake);
      fake.snapshots.push(snapshot); return snapshot;
    },
  };
  fake.bridge = bridge;
  return fake;
}
async function rejectsCode(action, code, phase) {
  await assert.rejects(action, error => {
    assert.ok(error instanceof VirtualUpdateError); assert.equal(error.code, code);
    if (phase) assert.equal(error.phase, phase);
    return true;
  });
}

for (const running of ['R16B', 'R48']) {
  test(`${running} small ABI1 update pins the recipient and forwards the complete reset extent`, async () => {
    const bytes = candidate(), fake = makeFake({running, target: 'R13'});
    const receipt = await new VirtualFirmwareUpdater(fake.bridge).update(bytes,
      {...optionsFor(bytes, markers.R13), expectedRunningMarker: markers[running], expectedRunningSha256: recipientHash(running)});
    assert.equal(receipt.preflight.profile.name, running);
    assert.equal(receipt.preflight.geometry.maximumImageBytes, 0x37f000);
    assert.equal(receipt.beforeSnapshot.firmwareHash, recipientHash(running));
    assert.deepEqual(fake.resetContract, {length: bytes.length, sha256: hash(bytes), expectedCurrentSha256: recipientHash(running)});
    assert.equal(receipt.bootStatus.build_marker, markers.R13);
    assert.equal(receipt.snapshot.firmwareHash, hash(bytes));
  });

  test(`${running} normal marker alone cannot admit an unpinned, stale or substituted running image`, async () => {
    for (const overrides of [{}, {expectedRunningMarker: markers[running]},
      {expectedRunningMarker: markers[running], expectedRunningSha256: '0'.repeat(64)}]) {
      const bytes = candidate(), fake = makeFake({running});
      await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, {...optionsFor(bytes), ...overrides}), 'running-image-pin', 'preflight');
      assert.deepEqual(fake.commands, []);
    }
    const bytes = candidate(), fake = makeFake({running, alterSnapshot: (_kind, snapshot) => {snapshot.firmwareHash = '0'.repeat(64);}});
    await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, {...optionsFor(bytes),
      expectedRunningMarker: markers[running], expectedRunningSha256: recipientHash(running)}), 'boot-snapshot', 'preflight');
    assert.deepEqual(fake.commands, []);
  });

  test(`${running} capacity does not admit generic larger ABI1 or ABI2`, async () => {
    const tooLarge = candidate(65540);
    await rejectsCode(() => prepareVirtualUpdateCandidate(tooLarge, optionsFor(tooLarge), running), 'image-size', 'image');
    const abi2 = candidate(); abi2[0x208] = 2;
    await rejectsCode(() => prepareVirtualUpdateCandidate(abi2, optionsFor(abi2), running), 'image-format', 'image');
  });

  test(`${running} stale replacement and partial completion cannot reach reset`, async () => {
    for (const mode of ['replace', 'partial']) {
      const fake = makeFake({running, alterSnapshot: (kind, snapshot) => {
        if (kind === 'before-reset' && mode === 'replace') snapshot.firmwareHash = 'f'.repeat(64);
      }, alter: (kind, status) => {
        if (kind === 'separate' && mode === 'partial') status.programmed -= 256;
      }}), bytes = candidate();
      await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, {...optionsFor(bytes),
        expectedRunningMarker: markers[running], expectedRunningSha256: recipientHash(running)}),
        mode === 'replace' ? 'boot-snapshot' : 'flash-result', 'separate-status');
      assert.equal(fake.resets, 0);
    }
  });
}

test('unretained R48 proof and excluded R16B proof are not recipient profiles', async () => {
  for (const running of ['R16B', 'R48']) {
    const fake = makeFake({running, initialMarker: markers[running] + 1});
    await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).inspect(), 'unknown-writer', 'inspect');
    assert.deepEqual(fake.commands, []);
  }
});

test('small preparation owns caller bytes and identifies both target and bounded protocol work', async () => {
  const bytes = candidate(), expected = hash(bytes);
  const pending = prepareVirtualUpdateCandidate(bytes, {expectedSha256: expected, expectedMarker: markers.R48}, 'R16B');
  bytes.fill(0);
  const plan = await pending;
  assert.equal(plan.image.sha256, expected); assert.equal(plan.targetWriter.name, 'R48');
  assert.equal(plan.recipient.name, 'R16B'); assert.equal(plan.blockers.length, 0);
  assert.deepEqual(plan.work, {dataReports: 37, sectors: 1, paddedReadbackBytes: 4096});
  assert.equal(hash(plan.bytes), expected);
});

// These optional local artifacts are read as bytes for host admission only.
// No guest executes, and no test copies a firmware payload into an output file.
const fullFixtures = [
  {recipient: 'R16B', target: 'stock-r3', file: new URL('../../sp404mk2/custom_firmware/build/original_r16b/RESTORE/SP404MKII_APP1_R3.bin', import.meta.url)},
  {recipient: 'R48', target: 'b1-r3-del-writer', file: new URL('../../sp404mk2/custom_firmware/build/usb_bridge_b1/r3/SP404MKII_APP1.bin', import.meta.url)},
];
for (const fixture of fullFixtures) {
  test(`${fixture.recipient} exact full target is prepared with explicit execution blockers`, {skip: !existsSync(fixture.file)}, async () => {
    const bytes = new Uint8Array(readFileSync(fixture.file)), pin = VIRTUAL_FULL_TARGETS[fixture.target];
    const options = {target: fixture.target, expectedSha256: pin.sha256, expectedRunningMarker: markers[fixture.recipient],
      expectedRunningSha256: recipientHash(fixture.recipient)};
    const plan = await prepareVirtualUpdateCandidate(bytes, options, fixture.recipient);
    assert.equal(plan.image.length, pin.length); assert.equal(plan.image.sha256, pin.sha256);
    assert.equal(plan.image.crc32, pin.crc32); assert.equal(plan.image.paddedLength, pin.paddedLength);
    assert.equal(plan.work.sectors, pin.sectors); assert.equal(plan.work.dataReports, Math.ceil(pin.length / 56));
    assert.deepEqual(plan.blockers.map(blocker => blocker.code), ['large-control-budget', 'large-ip-observer', 'target-fresh-boot']);
    assert.deepEqual(plan.resetTarget, {length: pin.length, sha256: pin.sha256,
      ...(fixture.target === 'b1-r3-del-writer' ? {selector: 'b1-del-writer'} : {})});
    const fake = makeFake({running: fixture.recipient});
    await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, options), 'large-execution-unqualified', 'image');
    assert.equal(fake.normalReads, 0); assert.deepEqual(fake.commands, []); assert.equal(fake.resets, 0);
    await rejectsCode(() => prepareVirtualUpdateCandidate(bytes, options, fixture.recipient === 'R16B' ? 'R48' : 'R16B'), 'recipient-target', 'image');
    const altered = new Uint8Array(bytes); altered[0x800] ^= 1;
    await rejectsCode(() => prepareVirtualUpdateCandidate(altered, options, fixture.recipient), 'image-hash', 'image');
    await rejectsCode(() => prepareVirtualUpdateCandidate(bytes, {...options, expectedSha256: '0'.repeat(64)}, fixture.recipient), 'full-image-hash', 'image');
  });
}

test('CRC matches independent IEEE vectors and command payload has no report-ID prefix', () => {
  assert.equal(updateCrc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(updateCrc32(candidate()), crc(candidate()));
  const command = updateCommand(2, 0x12345678, Uint8Array.of(9, 8), 2);
  assert.deepEqual(command.slice(0, 10), [2, 1, 2, 0, 0x78, 0x56, 0x34, 0x12, 9, 8]);
  assert.equal(command.length, 64);
  assert.throws(() => updateCommand(2, 0, new Uint8Array(57)), {code: 'invalid-command'});
});

test('separate preflight is read-only and validates both fixed diagnostic pages', async () => {
  const fake = makeFake(); const updater = new VirtualFirmwareUpdater(fake.bridge);
  const {profile, status} = await updater.inspect();
  assert.equal(profile.name, 'R13'); assert.equal(status.state, 0);
  const preflight = await updater.preflight(markers.R13);
  assert.deepEqual(fake.commands.map(command => command.opcode), [5, 7, 7]);
  assert.equal(preflight.status.flash_ready, 1);
  assert.equal(preflight.diagnostics.phase, 5);
  assert.equal(preflight.geometry.maximumImageBytes, 65536);
  assert.equal(fake.resets, 0);
});

for (const [running, target, proof] of [['R13', 'R14', false], ['R14', 'R13', false], ['R15', 'R15', true]]) {
  test(`complete ${running} to ${target}${proof ? ' proof' : ''} requires separate status and exact fresh boot identity`, async () => {
    const targetMarker = markers[target] + (proof ? 1 : 0);
    const initialMarker = markers[running] + (proof ? 1 : 0);
    const fake = makeFake({running, target, targetMarker, initialMarker});
    const bytes = candidate(); const progress = [];
    const result = await new VirtualFirmwareUpdater(fake.bridge).update(bytes,
      {...optionsFor(bytes, targetMarker), expectedRunningMarker: initialMarker, onProgress: event => progress.push(event)});
    assert.deepEqual(fake.uploaded, bytes); assert.equal(fake.resets, 1);
    assert.equal(result.ramVerified.state, 2); assert.equal(result.flashVerified.state, 6);
    assert.equal(result.separateStatus.state, 6); assert.equal(result.flashReadback.verifiedBytes, 4096);
    assert.equal(result.bootStatus.state, 0); assert.equal(result.snapshot.firmwareHash, hash(bytes));
    assert.equal(result.beforeSnapshot.firmwareHash, hash(Buffer.from(`fake-${running}`)));
    assert.equal(result.beforeResetSnapshot.firmwareHash, result.beforeSnapshot.firmwareHash);
    assert.deepEqual(progress.map(event => event.phase).filter((value, index, array) => value !== array[index - 1]),
      ['image', 'preflight', 'upload', 'ram-verified', 'commit', 'flash-verified', 'separate-status', 'reset', 'boot-verified']);
    assert.equal(fake.commands.filter(command => command.opcode === 2).at(-1).length, 32);
    assert.equal(fake.commands.some(command => command.opcode === 4), false);
  });
}

test('65536-byte ABI1 upper bound uploads exact ordered chunks and verifies all 16 sectors', async () => {
  const bytes = candidate(65536); const fake = makeFake();
  const result = await new VirtualFirmwareUpdater(fake.bridge).update(bytes, optionsFor(bytes));
  assert.equal(result.flashReadback.verifiedBytes, 65536);
  assert.equal(fake.commands.filter(command => command.opcode === 2).length, Math.ceil(65536 / 56));
  assert.deepEqual(fake.uploaded, bytes);
});

test('invalid image size, ABI metadata, hash or unsupported target sends no USB command', async () => {
  for (const [bytes, change, code] of [[candidate(2044), undefined, 'image-size'], [candidate(65540), undefined, 'image-size'],
    [candidate(), bytes => bytes[0x208] = 2, 'image-format'], [candidate(), bytes => bytes[0x401] = 0, 'image-format']]) {
    change?.(bytes); const fake = makeFake();
    await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, optionsFor(bytes)), code, 'image');
    assert.equal(fake.normalReads, 0); assert.deepEqual(fake.commands, []);
  }
  const bytes = candidate(); const fake = makeFake();
  await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, {...optionsFor(bytes), expectedSha256: '0'.repeat(64)}), 'image-hash');
  await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, optionsFor(bytes, 0x52400001)), 'target-writer');
  assert.equal(fake.normalReads, 0);
});

test('unknown running writer, non-idle transaction and mismatched pinned marker stop before probe', async () => {
  for (const [change, code] of [[state => state.signature = 'SPXX', 'unknown-writer'],
    [state => state.build_marker = 0x523d0003, 'unknown-writer'], [state => state.maximum = 0x400000, 'writer-contract'],
    [state => state.capabilities = 3, 'writer-contract'], [state => state.state = 6, 'writer-not-idle'],
    [state => state.received = 4, 'writer-not-idle']]) {
    const fake = makeFake({alter: (kind, state) => {if (kind === 'initial') change(state);}});
    const bytes = candidate(); await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, optionsFor(bytes)), code, 'preflight');
    assert.deepEqual(fake.commands, []);
  }
  const fake = makeFake(), bytes = candidate();
  await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes,
    {...optionsFor(bytes), expectedRunningMarker: markers.R14}), 'running-marker');
  assert.deepEqual(fake.commands, []);
});

test('probe errors, chip mismatch and bounded pending probe never send BEGIN', async () => {
  for (const [change, code] of [[state => state.flash_error = 11, 'firmware-rejected'],
    [state => state.jedec = 0xef4016, 'chip-profile'], [state => state.flash_status = 0x42, 'chip-profile']]) {
    const fake = makeFake({alter: (kind, state) => {if (kind === 'probe') change(state);}}), bytes = candidate();
    await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, optionsFor(bytes)), code);
    assert.deepEqual(fake.commands.map(command => command.opcode), [5]);
  }
  const fake = makeFake({waitProbe: 100}), bytes = candidate();
  await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge, {maximumProbePolls: 2}).update(bytes, optionsFor(bytes)), 'probe-timeout');
  assert.deepEqual(fake.commands.map(command => command.opcode), [5]);
});

test('diagnostic signature, page index, measured bytes and geometry flags are checked before upload', async () => {
  for (const [kind, offset, code] of [['diagnostics0', 0, 'diagnostic-page'], ['diagnostics1', 4, 'diagnostic-page'],
    ['diagnostics0', 8, 'sfdp-profile'], ['diagnostics1', 8, 'sfdp-profile'], ['diagnostics1', 60, 'sfdp-profile']]) {
    const fake = makeFake({alterRaw: (replyKind, bytes) => {if (replyKind === kind) bytes[offset] ^= 1; return bytes;}});
    const bytes = candidate(); await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, optionsFor(bytes)), code);
    assert.equal(fake.commands.some(command => command.opcode === 1), false);
  }
});

test('report-ID-prefixed and truncated responses fail the 64-byte virtual transport contract', async () => {
  for (const transform of [bytes => [0, ...bytes], bytes => bytes.slice(0, 63), bytes => {bytes[63] = -1; return bytes;}]) {
    const fake = makeFake({alterRaw: (kind, bytes) => kind === 'initial' ? transform(bytes) : bytes});
    await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).inspect(), 'report-framing');
    assert.deepEqual(fake.commands, []);
  }
});

test('ordered DATA acknowledgement and RAM verification each gate COMMIT', async () => {
  for (const [kind, change, code] of [['data', state => state.received--, 'chunk-result'],
    ['finish', state => state.crc32 ^= 1, 'ram-result'], ['finish', state => state.flash_ready = 0, 'ram-result'],
    ['data', state => state.build_marker = markers.R13 + 1, 'writer-changed']]) {
    const fake = makeFake({alter: (replyKind, state) => {if (replyKind === kind) change(state);}}), bytes = candidate();
    await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, optionsFor(bytes)), code);
    assert.equal(fake.commands.some(command => command.opcode === 6), false); assert.equal(fake.resets, 0);
  }
});

test('programmed byte count alone cannot establish full-sector flash verification', async () => {
  for (const [change, code] of [[state => state.flash_error = 14, 'firmware-rejected'],
    [state => state.flash_crc32 ^= 1, 'flash-result'], [state => state.programmed = 2048, 'flash-result'],
    [state => state.state = 2, 'commit-state']]) {
    const fake = makeFake({alter: (kind, state) => {if (kind === 'flash' && state.state === 6) change(state);}}), bytes = candidate();
    await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, optionsFor(bytes)), code);
    assert.equal(fake.resets, 0);
  }
  const fake = makeFake({waitFlash: 100}), bytes = candidate();
  await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge, {maximumFlashPolls: 2}).update(bytes, optionsFor(bytes)), 'flash-timeout');
  assert.equal(fake.resets, 0);
});

test('separate completion status failure preserves session without attempting reset', async () => {
  const fake = makeFake({alter: (kind, state) => {if (kind === 'separate') state.flash_crc32 ^= 1;}}), bytes = candidate();
  await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, optionsFor(bytes)), 'flash-result', 'separate-status');
  assert.equal(fake.resets, 0);
});

test('pre-reset unsupported MMIO and stale model diagnostics cannot be erased by a successful reset', async () => {
  for (const [kind, change] of [['before', snapshot => snapshot.unknownMmio = [0x401f0000]],
    ['before-reset', snapshot => snapshot.unknownMmioOverflow = 1],
    ['before-reset', snapshot => snapshot.flash.lastError = 'unsupported LUT'],
    ['before-reset', snapshot => delete snapshot.unknownMmio]]) {
    const fake = makeFake({alterSnapshot: (replyKind, snapshot) => {if (replyKind === kind) change(snapshot);}}), bytes = candidate();
    await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, optionsFor(bytes)), 'incomplete-model');
    assert.equal(fake.resets, 0);
    if (kind === 'before') assert.deepEqual(fake.commands, []);
  }
});

test('fresh marker, fresh BSS and executed candidate hash all gate boot completion', async () => {
  const bytes = candidate();
  for (const [setup, expectedMarker, code] of [[{target: 'R13', resetMode: 'bus-only'}, markers.R13, 'writer-not-idle'],
    [{targetMarker: markers.R14 + 1}, markers.R14, 'writer-changed'],
    [{target: 'R13', resetMode: 'old-image'}, markers.R13, 'boot-snapshot']]) {
    const fake = makeFake(setup);
    await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes,
      optionsFor(bytes, expectedMarker)), code, 'boot');
    assert.equal(fake.resets, 1);
  }
  const retainedProbe = makeFake({alter: (kind, status) => {if (kind === 'boot') status.flash_ready = 1;}});
  await rejectsCode(() => new VirtualFirmwareUpdater(retainedProbe.bridge).update(bytes, optionsFor(bytes)), 'boot-not-fresh');
});

test('the host owns candidate bytes and accepts the same entry envelope as the source validator', async () => {
  const bytes = candidate(); bytes.fill(0, 0, 4);
  const expected = bytes.slice(), fake = makeFake();
  const result = await new VirtualFirmwareUpdater(fake.bridge).update(bytes,
    {...optionsFor(bytes), onProgress: event => {if (event.phase === 'image') bytes.fill(255);}});
  assert.deepEqual(fake.uploaded, expected); assert.equal(result.image.sha256, hash(expected));
});

test('a guest fault or unsupported MMIO after new-image boot prevents a completed receipt', async () => {
  for (const change of [snapshot => snapshot.cpuBackendFailed = true, snapshot => snapshot.unknownMmio = [0xe000ed80]]) {
    const fake = makeFake({alterSnapshot: (kind, snapshot) => {if (kind === 'boot') change(snapshot);}}), bytes = candidate();
    await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes, optionsFor(bytes)), 'incomplete-model', 'boot');
    assert.equal(fake.resets, 1);
  }
});

test('missing snapshot and invalid polling bounds fail setup', () => {
  assert.throws(() => new VirtualFirmwareUpdater({transport: async () => [], reset: async () => {}}), {code: 'bridge-contract'});
  assert.throws(() => new VirtualFirmwareUpdater(makeFake().bridge, {maximumFlashPolls: 0}), {code: 'invalid-bound'});
});

test('concurrent clients and timeout retries cannot overlap an outstanding transport call', async () => {
  const fake = makeFake(); let release;
  const waiting = new Promise(resolve => {release = resolve;});
  const updater = new VirtualFirmwareUpdater({...fake.bridge, transport: () => waiting}, {operationTimeoutMs: 20});
  const first = updater.inspect();
  await rejectsCode(() => updater.inspect(), 'concurrent-client');
  await rejectsCode(() => first, 'operation-timeout');
  await rejectsCode(() => updater.inspect(), 'concurrent-client');
  release(report(fake.status)); await new Promise(resolve => setTimeout(resolve, 0));
  const result = await updater.inspect(); assert.equal(result.profile.name, 'R13');
});

test('cancellation after COMMIT neither resets the guest nor sends an automatic ABORT', async () => {
  const controller = new AbortController();
  const fake = makeFake({onCommand: opcode => {if (opcode === 6) controller.abort();}}), bytes = candidate();
  await rejectsCode(() => new VirtualFirmwareUpdater(fake.bridge).update(bytes,
    {...optionsFor(bytes), signal: controller.signal}), 'cancelled');
  assert.ok(fake.commands.some(command => command.opcode === 6));
  assert.equal(fake.commands.some(command => command.opcode === 4), false); assert.equal(fake.resets, 0);
});
