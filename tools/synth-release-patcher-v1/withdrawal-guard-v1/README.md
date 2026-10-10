# N1 withdrawal guard

N1 release and source builds are withdrawn after the owner reports missing pads. Actual file deletion and the cause remain unknown. The owner canceled SD inspection and replacement imports. This additive guard leaves frozen kit13, its source ZIP and all historical receipts unchanged. It installs no authority and operates no browser or device.

The current `tools/synth-release-patcher-v1/current.mjs` entry accepts read-only inspection of the held final07 handoff and exact candidate/restoration files. Build, upload, publication and override arguments refuse before any input or compiler access. Known withdrawn N1 hashes remain withdrawn after renaming. Unsealed successors and unrelated candidates receive no admission. The guard has no authority registry, recovery action or override switch.

```powershell
node tools/synth-release-patcher-v1/current.mjs --handoff HELD_FINAL07_HANDOFF.json --candidate EXACT_FINAL07.bin --restoration EXACT_P6S.bin --output NEW_PRIVATE_WITHDRAWAL_RECEIPT.json
```

`WITHDRAWN_N1_SAMPLE_PRESERVATION_INCIDENT` is the current decision even when historical source and byte inspection passes. The result leaves build execution, recording tests, software eligibility, delivery and public release disabled. P6S restoration is scoped to APP1 firmware with `sample_backup:false`, `project_backup:false` and `missing_pad_recovery_established:false`. Firmware bytes and flash readback contain no verified owner project or sample backup.

The [source audit](SOURCE_AUDIT.md) finds explicit project metadata writes in the selected SAVE adapter. Current project, path, task, descriptor and byte-count checks do not snapshot existing pad metadata or sample files, provide rollback, or cover delegated native idle/project-load behavior. These are source findings. No physical START or SAVE was reported in the incident, so this write path is not an established cause.

The concrete source-patcher gap is a candidate-bound populated-project preservation contract and verified evidence before source/build or delivery eligibility can be reconsidered. The corrected source must first address the diagnosed native load/save behavior. Compare P6S and the corrected candidate using identical populated storage, retain all 160 selected-project pad rows and sample bytes, and check other-project sentinels. Normal boot, chooser/cancel, refused destinations, file-open/header/read failures and dirty fallback must preserve prior data. A successful authorized recording may change only its intended empty destination and declared project metadata. Physical preservation and project backup remain separately established facts.

The browser delivery owner confirms the current root bench registry is empty; its source file hash is recorded in the review. The guard neither changes that registry nor uses historical seals to grant authority. Source promotion, publication and firmware restoration have not been performed here.

The focused regression passes 28 checks with zero skips, including actual historical handoff inspection, the normal current CLI, build refusal before missing input access, renamed withdrawn hashes, false readiness/backup claims, the empty browser registry and all sixteen frozen kit13 source snapshots. No firmware compiler or CPU suite ran. Set `OPENSP_WITHDRAWAL_SYNTH_ROOT` to retained synth evidence and run:

```powershell
node --test tools/synth-release-patcher-v1/withdrawal-guard-v1/test-guard.mjs
```
