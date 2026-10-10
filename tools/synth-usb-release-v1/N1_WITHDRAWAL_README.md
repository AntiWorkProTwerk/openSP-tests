# N1 delivery withdrawn

The owner reports that all their pads are missing after the final07 openSynth
N1 trial. Current N1 delivery and testing are halted. Sample-file deletion,
the affected project and the cause remain unverified. Root removed the private
candidate authority and stopped the port 8768 server. See the
[incident record](../../../sp404mk2/analysis/hardware/opensynth_n1_missing_pads_20261006/README.md).
Do not start the server or use the historical seal to resume the trial.

The current [registry](root-seals-v1.ts) contains zero entries. Its raw file is
634 bytes, SHA-256
`ca85db5362e557ed751491b07cb7c9ce98bb3c98480623b0685cc936d8db9f47`.
The historical approved V2 transaction remains in
`../sp404mk2-synth/build/openSynth-n1-sealed-final07-v2-01`:

| Historical file | Bytes | SHA-256 |
| --- | ---: | --- |
| `OWNER_TEST_ELIGIBILITY.json` | 6,378 | `0131a8dc07bb52408659fc896845d97cc40644349e04fb78aa238fb0aefad14c` |
| `ROOT_BENCH_SEAL.json` | 918 | `ce7e7162937004d5cacd74ba59cf7b88ebc744b5a3ffcaeb473e5690c24961ce` |

Admission requires a match in the current registry. The preserved manifest,
seal and caller-supplied approval fields cannot create that match. V1 keeps its
original repeated-take contract; V2 keeps its restricted first-take contract.
Neither contract admits N1 through the empty registry.

`inspectLocalBenchByteBindings` performs structural inspection of supplied
historical bytes. For the old approved transaction it still reports
`rootReviewedSoftwareEligible: true`, preserving what root reviewed then.
It always reports `transferAuthorityGranted: false`. Its structural blocker
list and a preparation/server inspection are not current admission status.
Current admission rejects the old N1 manifest before reading its seal,
candidate, restoration or software proofs. Both browser entries leave Connect
and Write disabled when this check fails.

The [withdrawal regression](test-n1-withdrawal.mjs) passes 12 tests with no skips.
It authenticates the real historical seal and current registry, checks actual
V1 and V2 browser entries in a Node DOM model, and exercises bounded failure
paths in the host HID model. No server, browser session or physical device is
used. Bad flash-profile preflight closes the modeled session after opcode 5;
it cannot send upload or commit commands, reuse that session or accept a
fabricated preflight. A profile-command timeout also closes the session within
its configured bound. Normal Roland descriptors and malformed status framing
also fail before any APP1 command.

From the OpenSP directory, run only this offline regression:

```powershell
node --import ./tools/register-test-typescript.mjs --test tools/synth-usb-release-v1/test-n1-withdrawal.mjs
```

B2 has physical APP1 programming evidence, including N1's padded-sector
readback and separate status check. That evidence does not establish sample
preservation. Exact P6S restoration retains its 21 evidence files and separate
transport qualification; firmware restoration is not a project or sample
backup and does not establish recovery from this incident. Untouched-stock
USB first installation remains unsupported. The normal Roland endpoint is
never a writer.

A corrected candidate needs a new exact artifact handoff and root review of
sample-preservation evidence on populated projects, including loading, idle
saving and failure paths. Existing sample bytes, all 160 pad rows, names,
markers and other-project sentinels must be checked. No corrected candidate
or new upload authority is established by this regression. Historical reviews,
failed candidates and physical transaction receipts remain unchanged.
