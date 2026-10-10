/** Select pending delivery or a modeled return at an ordinary instruction boundary. */
import {captureExceptionReturn, type PcTransferPlan, type ReturnTransferCPU} from './exception-return.ts';
import type {CortexMExceptions} from './exceptions.ts';

export interface InstructionBoundaryCPU extends ReturnTransferCPU {
  readonly backendFailed: boolean;
  stop(): void;
}
export interface InstructionBoundaryActions {
  interrupt(): void;
  exceptionReturn(transfer: PcTransferPlan): void;
}

/** Construct once per session; continuing instructions allocate no result object. */
export function createInstructionBoundaryHandler(
  cpu: InstructionBoundaryCPU,
  exceptions: Pick<CortexMExceptions, 'activeException' | 'hasDeliverablePending' | 'beforeInstruction'>,
  actions: InstructionBoundaryActions,
): (address: number, size: number) => void {
  const healthy = () => {
    if (cpu.backendFailed) throw new Error('Instruction boundary requires a healthy CPU backend.');
  };
  return (address, size) => {
    healthy();
    const deliverable = exceptions.hasDeliverablePending();
    healthy();
    if (deliverable) {actions.interrupt(); cpu.stop(); return;}
    const transfer = captureExceptionReturn(cpu, address, size, exceptions.activeException);
    healthy();
    if (transfer) {actions.exceptionReturn(transfer); cpu.stop(); return;}
    exceptions.beforeInstruction(address, size);
    healthy();
  };
}

