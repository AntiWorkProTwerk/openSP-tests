/** Rev3 GPIO DR reads: output latch for GDIR1, routed input sample for GDIR0. */
export function gpioReadData(latch: number, direction: number, padSamples: number, inputRoutes: number): number {
  return ((latch & direction) | (padSamples & ~direction & inputRoutes)) >>> 0;
}

/** The caller supplies pad samples; electrical loopback and settling are separate. */
export function gpioReadPadStatus(padSamples: number, inputRoutes: number): number {
  return (padSamples & inputRoutes) >>> 0;
}

/** GPIO1/2 ALT5 routes select the ordinary bank when the GPR26/27 bit is clear. */
export function gpioInputRouteEnabled(mux: number, highSpeedSelected: boolean): boolean {
  return (mux & 7) === 5 && !highSpeedSelected;
}
