# Thumb conditional execution qualification

The current local four-repair engine passes all47 original Thumb conditional
cases, including strict slice counts, code-hook stops and observed IT state.
Its [qualification](../../sp404mk2/analysis/emulator/vendor_candidate_m7_host_regs_20261003/thumb-it-qualification/qualification.json)
uses the original fixture and expectations. General retirement timing and full
firmware behavior remain unqualified. The earlier single-repair
[retained report](../tools/emulator-evidence/thumb-it-qualification-20261003c/qualification.json)
contains17 failed scheduling checks; its overall result remains failed. The
observations below describe that historical engine.

The fixtures cover IT, ITE and ITTTT with both condition outcomes, preserved
registers, arithmetic, mapped exits, one-instruction slices, a repeating 2/1/3
budget and explicit code-hook stops. Final-slot BX and POP use ordinary mapped
Thumb targets. All cases reach their mapped exit with the expected registers,
NZCV and inactive IT state. No case executes guest firmware. The
[assembly](../tools/fixtures/emulator-thumb-it.S) and
[runner](../tools/test-emulator-thumb-it.mjs) are retained with their compiled
artifacts, disassembly, source hashes and engine pins in each report directory.

The architectural reference is
[Arm DDI0403E.e](https://documentation-service.arm.com/static/606dc36485368c4c2b1bf62f),
sections A7.3 and A7.7.38. The reference expects each passing conditional slot to
apply its register operation and advance IT state; failing slots preserve their
registers. The runner compares those effects separately from callback counts.

| Fixture and outcome | Full-run counted starts | One-start slices counted starts | Observed effect |
| --- | ---: | ---: | --- |
| IT, EQ passes | 4 | 3 | Conditional MOV retires without its callback in the small-slice run |
| ITE, either outcome | 4 | 3 | Passing ADD or SUB retires without its callback |
| ITTTT, EQ passes | 7 | 3 | All four arithmetic slots retire without their callbacks |
| IT/ITTTT, EQ fails | 3 | 3 | Conditional slots are skipped |

These counts include CMP, IT and the final unconditional MOV. A depleted native
count can skip user callbacks while continuing the block. Board ticks agree
with the adapter's counted callbacks, so they undercount retired instructions in
these cases. Calling stop from a passing conditional slot lets later callbacks
arrive; the adapter's stopped flag then suppresses their counts. Strict expected
hook traces fail in 15 cases. The report preserves those expectations.
The separate [count comparison](../tools/emulator-evidence/thumb-it-qualification-20261003c/count-comparison.json)
records 19 differences between expected passing instruction starts and adapter
counts across all 47 cases, including the mapped-target transfer cases.

All observed code-hook and slice-return xPSR IT fields are zero. No slice in
this qualification returns inside an IT block. That observation does not
establish that a mid-block xPSR read reports architectural IT state. The pinned
translator keeps condition state in translation metadata and restores it when
leaving the translated block, as described in
[translate.c](https://github.com/unicorn-engine/unicorn/blob/8028ec436f2d9376525352dd38ed9ed6b9f6be10/qemu/target/arm/translate.c#L11343).

Two additional checks request a stop before a final IT-slot BX or POP. Both
transfers retire, and the mapped target's MOV also runs before control returns.
POP advances SP by four bytes. Registers, flags and the backend remain healthy,
but the stop-before-transfer assertion fails. These results qualify the legal
instructions' effects; they do not qualify the session's interception of
EXC_RETURN transfers in a final IT slot. No EXC_RETURN target was executed here.

The source explains this boundary: conditional instructions place the condition
check before their code hook, tag the hook with UC_HOOK_FLAG_NO_STOP and omit the
ordinary exit check. The trace helper cancels stop requests for these hooks.
The [source review](../tools/emulator-evidence/thumb-it-qualification-20261003c/source-contract.json)
pins the inspected transformed source files.
See the pinned
[Thumb translator](https://github.com/unicorn-engine/unicorn/blob/8028ec436f2d9376525352dd38ed9ed6b9f6be10/qemu/target/arm/translate.c#L11576)
and [trace helper](https://github.com/unicorn-engine/unicorn/blob/8028ec436f2d9376525352dd38ed9ed6b9f6be10/uc.c#L2097).
Clearing IT state at a slice boundary would change architectural state and is
not supported by these results. An engine change that synchronizes PC and IT
state before honoring a hook stop needs separate qualification. Until then,
instruction timing and session transfer interception retained this limit on
that earlier engine.

The CPU and session were unchanged. The engine WASM is
16599c54af6da32ecce2ce52538890610a83c96e1152796ddffa2533d6440b35;
cpu.ts is fb27f37e31277b4e79d1847562c961de23acd25befc4015ffbfd2a3c7d7809b1.
The first build failed because exported exit labels lacked Thumb relocation
types; changing their unused sink branches to local self branches fixed the
fixture build. Its [build record](../tools/emulator-evidence/thumb-it-qualification-20261003/build-attempt.json)
and the [first 37-case report](../tools/emulator-evidence/thumb-it-qualification-20261003b/qualification.json)
remain separate evidence.

Run `node tools/test-emulator-thumb-it.mjs <new-output-directory>` with the ARM
toolchain available in the sibling firmware workspace, or supply its directory
as the second argument. Output directories are write-once. The default public
runtime now passes the covered strict checks; older reports remain unchanged.

The isolated [hook-stop candidate](../../sp404mk2/analysis/emulator/vendor_candidate_it_hook_stop_20261003/README.md)
uses the same 47 assembled cases. Its
[report](../../sp404mk2/analysis/emulator/vendor_candidate_it_hook_stop_20261003/thumb-it-qualification/qualification.json)
passes every original assertion, including the 17 stopping checks and all 19
reference-count comparisons. Added checks observe each hook's architectural IT
state and matching slice-return state. The runtime is supplied explicitly as
the third argument; those results did not change the old reports or public
assets at that checkpoint. It also passes12 generic CPU groups and an ordinary R13/R14
roundtrip. Its bounded whole-stock run completes scatter and one million later
hook starts, ending on its budget while the DCDC readiness model is missing.
Complete stock boot and general instruction retirement remain separate checks.

The subsequent four-repair composition retains these passing conditional checks
and adds host XPSR flag refresh and raw live M7 stack/mask access. Separate
ordinary R13/R14 acceptance passed before its
[local promotion](../../sp404mk2/analysis/emulator/vendor_candidate_m7_host_regs_20261003/local-promotion.json).
The previous vendor assets and documentation remain archived.
