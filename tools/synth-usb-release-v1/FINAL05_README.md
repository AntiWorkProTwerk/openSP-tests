# Held final05 bench proposal

The final109 proposal is
`../sp404mk2-synth/build/openSynth-n1-bench-final05-01`. It stays separate from
the historical core03 proposal. Its eligibility manifest SHA-256 is
`2c1e9b3eb78d0c88310e3d09e0bbaf371b0c300672f6e438b416c6561c1edfa4`.

| Exact subject | SHA-256 |
| --- | --- |
| Candidate | `dcdb25738f1f40cf517175592eddd28b465e2bbb17ca0dfd05ebdde6da18e1fe` |
| Module ELF | `e45e54672c4563bec7a21c26e3333e0d926c385b637de5d55ada2473ecdff207` |
| Module BIN | `6a33b0a05cb16c34516d09fe9a608f9b4b798ae8e04bfc514382c5e0bf402c09` |
| Source contract | `5121c1db487d8eefe426799c985f4bc9a73cd3e022ffeb4aea2bfd5355ab620f` |

The actual `openSynth N1` APP1 is 2,954,632 bytes, ABI2, CRC32 `5FBBD549`,
2,957,312 padded bytes and 722 sectors. The specific B2 format/capacity
inspection passes. Fresh device identity, chip profile, padded sector readback,
separately reopened status and real reboot checks remain necessary for a write.

Preparation authenticated 356 source-authority files, 310 built source files,
109 objects and 96 stack receipts, with 202 native recipe patches. The producer
retained 101 authenticated current-transaction units, compiled eight updated
units and linked a fresh successor module. The entry was not executed as one
fresh end-to-end build; prehook imports and OS/stdlib/compiler-internal reads
retain their declared tracing limitations. No compiler was rerun here.

The frozen final source/tool/module/image replay receipt is
`final-verification-05/REPORT.json`, SHA-256
`360580eb06b3210d5f98282ff4e118efb19e3d1027a30f60757d2affcda71a65`.
It establishes static byte/source replay only. The proposal also includes the
new final05 B2 envelope receipt, SHA-256
`c6139d33f10272a6804ed84512e311068deb759c96e7d5e17eb3d182c23546a0`.
Neither receipt supplies linked audio, cold memory/lifetime, runtime,
recording-flow or final composition qualification.

The pattern worker subsequently found a source defect: the generic Synth
button translator rejects PATTERN SELECT20 before opening the chooser. This
exact final05 image now has an explicit bench hold. Its static01 snapshot stays
unchanged; a corrected single-entry-role successor needs a new exact subject.
The metronome's narrow linked component result does not clear the pattern
failure or establish the full composition.

The additive `openSynth-n1-bench-final05-02` proposal records the explicit
pattern hold and pins the narrow metronome V5 handoff under composition.
Its manifest SHA-256 is
`c102b7612a7e0896a473015c61aeda04ad4f2e4d0bd19a24fbfb40cfd6e8f448`.
Metronome receipt SHA-256:
`a57bbef29887f06b5a3813515526cb87928a91b624153f83a023312145ef7b10`.
That component result supplies no passing pattern/composition conclusion.

Those five qualifying roles and root review remain missing from the frozen01 snapshot. Software
eligibility, candidate upload, hardware qualification and public release are
false. The root authority registry remains empty. The exact P6S restoration
and its 21 historical/physical evidence files are unchanged.

The [bench contract](BENCH_README.md) requires actual exact-subject software
receipts and a separate root review. Its runtime scope covers a software timing
model and memory headroom with declared fixture limitations. Physical N1
deadline, durable save/persistence and a 120-second recording remain later
owner acceptance checks; no prior same-candidate hardware proof is required
for first-test software admission. Root alone installs a reviewed seal and
authorizes device access.

As completed receipts arrive, create a new proposal directory with their exact
paths using `prepare-bench.mjs`; preserve the held01 snapshot. The unreviewed
root template remains held until root reviews every required scope. This task
starts no server and performs no seal, registry, browser, USB or compiler action.

Focused retarget checks run from OpenSP:

```powershell
node --import ./tools/register-test-typescript.mjs --test tools/synth-usb-release-v1/test-final-proposal.mjs
```
