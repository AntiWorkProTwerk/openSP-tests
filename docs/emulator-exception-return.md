# Instruction-backed exception returns

[The return adapter](../src/lib/emulator/exception-return.ts) identifies a Thumb
instruction and its raw target before execution. A top-F fetch address alone
cannot establish an exception return. Arm permits that interpretation in Handler
mode for BX, POP/LDM including PC, and LDR to PC. Other PC-writing instructions
and Thread-mode branches keep their ordinary instruction semantics.
The source is [Arm DDI0403E.e](https://documentation-service.arm.com/static/606dc36485368c4c2b1bf62f),
pages A2-31, A7-215, A7-242 through A7-251, A7-319 through A7-320, and
B1-539 through B1-543. Its hash is retained in the
[FP source ledger](../tools/emulator-evidence/exception-fpu-qualification.json).

`captureExceptionReturn(cpu, address, size, activeException)` returns an
immutable plan for a supported instruction supplying one of the six valid raw
EXC_RETURN tokens. It returns `null` for an ordinary target, unrelated opcode
or Thread mode. Reserved/even raw tokens raise explicit model errors; their
Thumb bit is never reconstructed from a later fetch address. A passing condition
and a final IT-block position are required. Source reads are limited to mapped
ordinary memory when the CPU supplies its memory map. Device/system-memory
loads cannot be predicted from their host backing bytes and are refused.

The qualified forms include BX register; narrow and wide POP; increment-after
and decrement-before LDM; LDR positive/negative immediate, pre/post-indexed,
shifted-register and positive/negative literal forms. The literal base is
`Align(instructionAddress + 4, 4)`. The decoder checks reserved encoding bits,
register-list restrictions, writeback/base overlap and aligned PC-load data.
It recognizes single-register wide POP through its LDR alias.

General LDM writeback has a deliberate boundary. The normative pseudocode
loads PC before updating its base, and exception return synchronously restores
core registers and can select another stack. A pretrap may therefore move that
writeback before unstack only for R4 through R11, whose values and register bank
survive the hardware frame. Other general LDM writeback bases are refused.
LDMIA `SP!` is the documented POP alias: POP advances the current SP before
loading. Non-writeback LDM retains every legal base. This distinction follows
the instruction pseudocode and preserves the unresolved cases explicitly.

The runner integration is:

1. After deciding to stop for an interrupt, capture the return plan before the
   instruction executes. If a plan exists, save it, stop the CPU and return from
   the callback. Otherwise run the FP instruction hook last.
2. After the CPU slice, normalize FP state while the backend remains available.
   Apply the saved plan with `applyPcTransferEffects(cpu, plan)`, then call
   `exceptions.returnFromException(plan.target)` with the raw token.
3. Remove the generic top-F fault fallback. An unsupported origin remains a
   fault; it must not acquire an exception-return meaning from its fetch PC.

Applying a plan checks the instruction PC, xPSR, stack selection, source
registers, instruction bytes and memory words again before any write. It updates
only the software instruction's loaded registers and qualified writeback.
It never writes PC, consumes the hardware frame or restores a hidden register
snapshot. The architectural dispatcher performs the subsequent unstack. Plans
must be consumed at that stopped instruction boundary rather than carried
across CPU execution. Callback retries and interrupted or stale plans require
fresh capture.

[The focused tests](../tests/emulator-exception-return.test.mjs) cover 45 groups:
26 register/memory groups and 19 groups using the real M7 WASM engine. Seventeen
assembled instruction forms branch to an ordinary mapped target and match the
decoded software effects. Further executed cases cover IT skipping and a
stop-before-transfer plan. No EXC_RETURN target is executed by that engine suite,
and read failures use an injected JavaScript error. The model tests separately
exercise raw tokens, refusals, freshness and software POP followed by hardware
unstack. The first test run had a signed JavaScript expected-value error in its
benign target assertion; converting that expected value to unsigned fixed the
assertion. The engine transfers themselves had already matched their targets.

The later [conditional-instruction qualification](emulator-thumb-conditional.md)
found that stopping before a passing final IT-slot BX or POP is deferred by the
current engine. Those transfers use ordinary mapped targets, so the finding
qualifies hook scheduling without executing an EXC_RETURN token. The 45 groups
above establish decoding and software effects; final IT-slot interception in a
running session remains unqualified until that stopping contract is repaired.

Run the source-pinned qualification with:

```powershell
node tools/test-emulator-exception-return.mjs
```

The [receipt](../tools/emulator-evidence/exception-return-qualification.json)
records source/runtime hashes and counts. Fault rollback, MPU/MMIO load effects,
interrupted multiple-load continuation and the excluded LDM writebacks remain
unmodeled. Counts describe emulator instruction starts and host transitions,
not physical processor cycles. These fixtures do not establish stock RTOS boot
or physical SP behavior.
