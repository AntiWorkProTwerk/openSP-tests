# Cortex-M7 exceptions in the emulator

[The dispatcher](../src/lib/emulator/exceptions.ts) uses the CPU engine's registers
and memory. Entry stacks R0, R1, R2, R3, R12, LR, PC and xPSR on the selected
Thread stack, then runs the handler on MSP. Return consumes the frame at the
current MSP or PSP, allowing an RTOS to select another task's frame. R4 through
R11 remain the firmware's responsibility. Pending exceptions can tail-chain
without unstacking the interrupted frame.

The model follows the [Cortex-M7 Generic User Guide](https://documentation-service.arm.com/static/61efd6602dd99944d051417b),
sections 2.1.3, 2.3 and 4.2 through 4.4, and the
[ARMv7-M Architecture Reference Manual](https://documentation-service.arm.com/static/5f8fef3af86e16515cdbf816),
section B1.5.8. M7 stack alignment stays enabled. The stacked xPSR alignment
bit restores padding; PRIGROUP, BASEPRI, PRIMASK and FAULTMASK determine
delivery. SysTick reloads on a separate source edge and coalesces pending wraps.

The constructor takes an interrupt count, priority-bit count and vector-table
alignment. Their defaults are emulator configuration, not a new SP hardware
survey. SysTick advances in supplied source ticks. Instruction starts are not
measured processor cycles or physical time.

`dispatchPending()` and `returnFromException()` run at instruction boundaries.
Core peripheral reads and writes route through `readMmio()` and `writeMmio()`;
unowned addresses return `undefined` and `false`. A runner can use
`isExceptionReturn()` when a Handler-mode BX or PC load targets the top-nibble-F
range. Raw branch-register values require strict return-token validation.
`returnFromException(pc, { fromFetch: true })` is reserved for an instruction
engine's subsequent fetch address, where bit 0 may already have been cleared.
That fallback alone cannot prove that the original branch token had bit 0 set.

[The tests](../tests/emulator-exceptions.test.mjs) run with:

```powershell
node --test tests/emulator-exceptions.test.mjs
```

The current 31 groups include 28 register/memory model tests and three tests with
the real Cortex-M7 WASM engine. A guest handler edits stacked R0 using STR,
changes R4 and resumes the interrupted instruction after return. Another
executes VFP, checks automatic FPCA and verifies refusal of an extended frame.
The third executes a software PUSH/POP handler, then consumes the engine's
EXC_RETURN fetch token after POP restores its software stack. A separate
single-edge reference checks bulk SysTick advancement across 200 batches.
These checks do not establish a running stock RTOS or complete SP behavior.

FPU and lazy frames, non-base Thread return, late arrival, fault escalation,
sleep and exclusive monitors remain unmodeled. Active or extended FPU frames
and unsupported return contexts raise explicit errors. AIRCR reset actions
require board reset integration. The backend's FPU permission behavior, frame
contents and lazy preservation need verification before floating-point exception
frames can be qualified.

The first VFP experiment omitted a terminating loop, leaving zero-filled SDRAM
after its instructions. Translation aborted before the first instruction and
closing that aborted backend raised a second WASM error. The complete fixture
passes; the [failed fixture and corrected observation](../tools/emulator-evidence/exception-fpu-boundary.json)
remain preserved. Instruction budgets alone do not establish bounded translation
or recovery from every backend failure.
