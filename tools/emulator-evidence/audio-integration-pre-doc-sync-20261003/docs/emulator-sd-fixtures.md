# Session and Worker SD fixtures

[`SessionOptions`](../src/lib/emulator/session.ts) and
[`EmulatorWorkerBridge.load()`](../src/lib/emulator/worker-rpc.ts) accept optional
`sd1` and `sd2` local byte images. Each input is a `Uint8Array` or `ArrayBuffer`
with an unshared, attached backing buffer. Both slots use the existing
[read-only SDSC geometry](emulator-usdhc-contract.md): 256 KiB through 128 MiB,
in exact 256 KiB units. Admission uses a typed-array view's length and offset;
it does not pad, round capacity, inspect a filesystem or open host media.

```ts
const session = await createSession(firmwareBytes, {
  format: 'app1',
  sd1: localCardBytes,
  sd2: secondLocalCardBuffer,
});

const loaded = await bridge.load(firmwareBytes, {
  format: 'app1',
  sd1: localCardBytes,
});
```

Omitting a slot constructs no controller, so its MMIO window remains unknown.
The session passes only `{image: ownedBytes}` into the existing board contract.
`SPBoard` owns controller instances, IRQ110/111 routing and card scheduling;
the load API exposes no IRQ callback, instance override or timing configuration.
The public page supplies no SD fixtures and has no card controls.

[`sd-fixtures.ts`](../src/lib/emulator/sd-fixtures.ts) validates both inputs
before copying either. Direct session construction owns the bytes immediately;
`createSession()` copies them before its first asynchronous firmware admission.
Each slot and session gets independent ownership, including when a caller reuses
one buffer. Typed-array subclass copy hooks cannot replace the owned allocation.
The session discards raw card fields from its retained options after controller
construction. Later mutation or detachment of the caller's bytes cannot change
the card.

The RPC bridge validates and copies cards before posting a load request. It
transfers separate copies of the firmware and each supplied card, preserving the
caller's buffers. The production Worker repeats fixture validation and ownership
before pausing or replacing its current session. Invalid cards reject before
session creation; the earlier session remains available. Shared-backed views,
detached buffers, other typed arrays and objects containing card options are
refused. Error text contains the slot and contract, with no card content.

Session reset recreates the CPU while keeping the board's existing card objects.
Board reset clears host-controller registers, pending work and IRQ state while
retaining card bytes, presence, protocol state and diagnostic counters. CMD0
remains the explicit card-protocol reset. Resetting unfinished PIO retains the
controller's documented limitation; these tests establish no physical card power
cycle or reinsertion behavior.

Snapshots and traces expose only each controller's scalar metadata and bounded
diagnostics under `sd1`/`sd2`. RPC request subscribers receive the synthetic
profile, capacity and `readOnly: true`, excluding filenames, hashes and backing
buffers. Reply admission copies only documented SD status fields and discards
unexpected content properties, including nested diagnostic properties. Invalid
SD reply metadata closes the bridge using its last safe cached evidence. Fixture
bytes are absent from observers, snapshots, traces and qualification receipts.
Future guest code could expose card content through its own outputs; those
outputs require a separate evidence review when qualifying whole firmware.

[`emulator-sd-fixtures.test.mjs`](../tests/emulator-sd-fixtures.test.mjs) has
15 helper, RPC and production-message-handler cases. The handler runs with fake
session boundaries, while real fixture validation checks ownership, geometry,
replacement order and private observations.
[`emulator-session-sd.test.mjs`](../tests/emulator-session-sd.test.mjs) has 12 cases
using the real session, board and USDHC models with a fake CPU whose `step()`
throws. They cover copying before asynchronous admission, independent cards,
fixed routing, absent slots, reset retention, pending work and metadata privacy.
They execute zero guest instructions and load no engine or firmware file.

The [qualification receipt](../tools/emulator-evidence/sd-fixtures-qualification-20261003.json)
pins sources/tests and pre-edit preservation. All 138 focused model and protocol
checks pass, including existing USDHC, RPC and reset-contract cases; strict
TypeScript checking passes for the four changed production files. These checks
establish the fixture plumbing. Whole-firmware storage, browser delivery,
filesystem compatibility and physical-device behavior remain separate acceptance
work. No SD or firmware bytes are retained in the receipt.
