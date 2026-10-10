/** Rev3 GPIO DR reads: output latch for GDIR1, routed input sample for GDIR0. */
export function gpioReadData(latch: number, direction: number, padSamples: number, inputRoutes: number): number {
  return ((latch & direction) | (padSamples & ~direction & inputRoutes)) >>> 0;
}

/** The caller supplies pad samples; electrical loopback and settling are separate. */
export function gpioReadPadStatus(padSamples: number, inputRoutes: number): number {
  return (padSamples & inputRoutes) >>> 0;
}

/** GPIO1/2 ALT5 routes select the ordinary bank when the GPR26/27 bit is clear. */
export function gpioInputRouteEnabled(mux: number, muxModeMask: 7 | 15, highSpeedSelected: boolean): boolean {
  return (mux & muxModeMask) === 5 && !highSpeedSelected;
}

/** Rev3 GPIO_AD_B0_00..08 and12..13 reserve bit3; the other scoped pads use bits3:0. */
export function gpioMuxModeMask(bank: 1 | 2, pin: number): 7 | 15 {
  if ((bank !== 1 && bank !== 2) || !Number.isInteger(pin) || pin < 0 || pin >= 32)
    throw new RangeError('GPIO mux field requires bank1/2 and pin0..31');
  return bank === 1 && !!(0x31ff & (1 << pin)) ? 7 : 15;
}
