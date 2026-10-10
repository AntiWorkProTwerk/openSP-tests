# Browser Worker update bridge

[`EmulatorWorkerBridge`](../src/lib/emulator/worker-rpc.ts) connects one owned
browser Worker to the [virtual update host](emulator-update-contract.md). Its
`transport`, `reset` and `snapshot` methods implement `VirtualUpdateBridge`.
`load`, `step`, `input`, `run`, `pause`, `restart` and `trace` expose the existing session
protocol. The module uses a local SD fixture helper and opens no physical USB
connection. Importing it creates no Worker; `createBrowserWorkerBridge()` creates
one when called.

Give each parallel session a separate bridge and Worker. The bridge owns request
IDs, listeners and termination; do not attach it to a Worker already controlled
by another RPC client. The `/emulator/` controller imports the bridge on Start
and uses it for every session command. It owns no Worker, request IDs or raw
reply listeners. Each session closes its own bridge on replacement, removal or
page hide. Selected firmware bytes remain local.

```ts
import {createBrowserWorkerBridge} from '../src/lib/emulator/worker-rpc.ts';
import {VirtualFirmwareUpdater} from '../src/lib/emulator/update.ts';

// Invoke from an explicit session-start action; these bytes remain local.
const bridge = createBrowserWorkerBridge();
const cancellation = new AbortController();
try {
  await bridge.load(await selectedFile.arrayBuffer(), {
    format: 'app1',
    name: selectedFile.name,
    signal: cancellation.signal,
  });
  await bridge.reset({signal: cancellation.signal});
  const updater = new VirtualFirmwareUpdater(
    bridge.asUpdateBridge({signal: cancellation.signal}),
    {operationTimeoutMs: 45000},
  );
  const receipt = await updater.update(candidateBytes, {
    expectedSha256: candidateManifest.sha256,
    expectedMarker: candidateManifest.marker,
    expectedRunningMarker: runningManifest.marker,
    signal: cancellation.signal,
  });
  retainVirtualEvidence(receipt, await bridge.trace());
} finally {
  bridge.close();
}
```

Bind the same signal with `asUpdateBridge()` and `updater.update()`. The update
host does not pass its signal into individual bridge callbacks. The example's
45-second host timeout exceeds the bridge's default 30-second request and boot
bounds, so a stalled bridge terminates its Worker before the host's outer timeout.
These identifiers represent caller-supplied files, manifests and evidence storage.

| Call | Matching completion |
| --- | --- |
| `load(image, {format, name?})` | `loaded`, then same-ID `status` |
| `transport(report?)` | `usb`, then same-ID `status`; exactly 64 payload bytes |
| `snapshot()`, `step()`, `input()`, `run()`, `pause()` | Same-ID `status` |
| `trace()` | Same-ID `trace` |
| `restart()` | Same-ID reset `status`, with `loaded` state and zero instructions; no boot steps |
| `reset()` | Reset status, followed by bounded step statuses and a fresh running mailbox |

Omitting a transport report sends a virtual GET_REPORT. Supplying a report sends
the 64-byte feature payload without a report-ID prefix. The bridge returns the
USB response only after its matching status arrives. It validates reply type,
framing, state, PC, instruction count, SHA-256 shape and the display/diagnostic
fields used by the page; the update host retains
the source-specific writer, readback and identity checks.

Concurrent replies resolve their own callers. An older request cannot overwrite
newer cached diagnostics. Retired or unknown positive IDs are ignored, including
duplicates after completion. A repeated primary reply before its trailing status
closes the ambiguous connection. Unsolicited ID-zero statuses update the cache
only during run intent, for the same image and a nondecreasing instruction count.
They cannot complete a request. `latestDiagnostics` returns a copied observation;
`snapshot()` requests a new correlated status. ID-zero publications have no
request correlation, so use fresh `snapshot()` replies for update verification.

`subscribe(observer)` reports validated, accepted snapshots, sent request IDs
and terminal errors. Snapshot events use the same ordering rules as the cache;
an older request can finish without publishing stale page state. Each observer
receives its own copy in a microtask. Callback exceptions are contained, and the
returned unsubscribe function suppresses queued deliveries. Observations cannot
settle requests. Request observations omit firmware image bytes. The page uses
these events for diagnostics and its bounded command ledger; load and USB busy
states end only when their bridge promises settle after the matching status.

The page uses `restart()` for generic reset, including stock firmware without an
original ABI mailbox. It recreates the CPU through the production reset command
and returns after the zero-instruction loaded acknowledgment. It does not execute
boot slices or imply startup success. The page replaces its snapshot so omitted
mailbox fields clear older markers. Async page work also checks the owning bridge
and session generation before changing state or releasing busy controls. Generic
restart can queue behind earlier input or trace requests; new calls are excluded
until its acknowledgment. The updater's bounded `reset()` still requires exclusive
access before it starts.

`reset()` requires exclusive access and sends the production Worker reset
command. That command delegates CPU recreation and NOR retention to
[`EmulatorSession.reset()`](../src/lib/emulator/session.ts). The bridge requires a
`loaded` reply with zero instructions, no recognized live mailbox (absent firmware state and heartbeat), and
explicitly false `cpuBackendFailed` and `mailboxCached`. It then executes guest
steps until a paused reply reports firmware state 2, a 32-bit marker and heartbeat, and
the same explicit health flags. Those mailbox fields are populated by the
session only after recognizing its `0x53503443` mailbox signature. A marker read
from the image header cannot finish this boot loop. After reset, the update host
reads a fresh USB status, checks the expected marker, and checks the executed-image
hash and model diagnostics.

`reset(callOptions)` remains supported. `reset(target, callOptions?)` additionally
accepts the explicit APP1 reset contract from the update host: `length`, `sha256`,
`expectedCurrentSha256` and optional `selector: 'b1-del-writer'`. The bridge checks
the exact field names, a 4..0x37F000-byte extent and complete hashes, copies the
contract, then forwards it as `target` to the Worker. The session owns the retained
NOR image and selector checks. `asUpdateBridge()` forwards the target and its bound
call options. Supplying a target does not relax fresh-mailbox verification or
qualify a larger-image update. The [update contract](emulator-update-contract.md)
records those separate limits.

The default boot budget is 4,000,000 requested instructions in slices of 25,000,
bounded by 30 seconds overall. Every slice must report forward progress within
the cumulative instruction budget. A stopped guest, cached mailbox, engine
failure, unrecognized mailbox at the budget limit or invalid reset acknowledgment rejects
the operation without a completion receipt. This boot condition is scoped to the
current original-firmware mailbox contract; it does not recognize stock firmware
startup or ROM execution.

Each RPC defaults to 30 seconds; image load defaults to 45 seconds. Options accept
1..300,000 milliseconds, boot budgets up to 100,000,000 instructions, and slices
up to 1,000,000. A call's `timeoutMs` applies to each request within `reset()`;
`bootTimeoutMs` separately bounds the whole reset. `run()` acknowledges continuous
execution and does not keep a pending RPC alive. Consumers should poll `snapshot()`
with bounded requests if they need a continuous-run liveness check. The page
retains its 15-second running-publication watchdog and closes the owned bridge
when that bound expires. The Start-time bridge import has a separate 45-second
loading bound before Worker creation; a late import cannot revive that session.

Timeout, in-flight cancellation, malformed correlated replies, Worker error or
message-error events, send failures and asynchronous ID-zero errors close the
bridge, reject pending work, remove listeners and terminate the owned Worker.
Pre-cancelled calls send nothing. A matching command error rejects that request
while leaving the bridge available for diagnostics. `close()` is idempotent, and
late responses cannot revive a closed bridge. Termination discards that session;
it provides no rollback or recovery guarantee for a virtual update already sent.

[`emulator-worker-rpc.test.mjs`](../tests/emulator-worker-rpc.test.mjs) uses injected
EventTarget ports to test correlation, ordering, report framing, cached evidence,
cleanup, cancellation, bounded fresh-mailbox recognition and update-host binding.
It does not execute a CPU, WASM, firmware or the production Worker, and its symbolic
reset fixture cannot establish actual CPU recreation or NOR retention. Production
guest results belong in the separate [emulator evidence](emulator.md). Run the
protocol tests with `node --test tests/emulator-worker-rpc.test.mjs`.

[`emulator-page-bridge.test.mjs`](../tests/emulator-page-bridge.test.mjs) runs the
actual controller in an isolated Node VM with a small DOM and injected protocol
port. It checks load/USB status gates, generic stock reset and stale file, import
and command completions. It runs no browser or CPU. The page's separate
[`emulator.spec.ts`](../tests/emulator.spec.ts) checks the built controls with a
mocked Worker, including delayed trailing statuses and session replacement.

The [production browser roundtrip](../tools/emulator-evidence/worker-rpc-browser-roundtrip.json)
passes in an isolated Canary157.0.8081.0 process with the repaired runtime pinned
in that report. [`emulator-worker-roundtrip.spec.ts`](../tests/emulator-worker-roundtrip.spec.ts)
serves the bridge and update host through test-only route fulfillment and creates
one real built Worker. Pinned local files enter through File inputs. After the
initial R13 load, R14 and the returning R13 enter only through executed firmware
feature reports.

The run records 658 USB transactions, each completing with its own USB reply and
same-ID status, alongside one actual unsolicited ID-zero publication. R13-to-R14
reads all 20,480 padded bytes through sequential FlexSPI IP reads; R14-to-R13 reads
16,384 bytes. Each leg obtains a separate completion GET_REPORT before reset.
Reset then reports zero instructions and no recognized live mailbox; bounded guest steps
reach fresh R14/R13 markers after 825,000/750,000 instructions, with matching
image hashes, healthy uncached backend state and zero unknown MMIO or overflow.
The final USB report is fresh and idle. Source, built Worker and downloaded engine
pins remain stable, with no firmware HTTP payloads or physical API accesses.

These browser observations establish the source-backed retained-NOR reset path
and executed APP1 identity. The trace exposes command addresses and lengths;
it does not expose raw NOR for an independent comparison of resident bytes or
the preserved larger-image tail. Whole-NOR comparisons remain part of the
separate direct-session evidence. The test adapter is absent from `dist/`. This
historical roundtrip predates the page-controller refactor and is not browser
verification of that refactor.

Optional local `sd1`/`sd2` load bytes follow the separate
[session fixture contract](emulator-sd-fixtures.md). Their admission and privacy
tests execute models and fake protocol boundaries; they add no SD filesystem or
guest storage claim to the earlier browser roundtrip evidence.
