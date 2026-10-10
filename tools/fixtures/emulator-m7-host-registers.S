.syntax unified
.cpu cortex-m7
.thumb
.text
.align 2
.global read_special, read_special_exit, write_special, write_special_exit
.global thread_arithmetic, thread_arithmetic_exit, interrupt_handler, interrupt_return
.thumb_func
read_special:
  mrs r0, msp
  mrs r1, psp
  mrs r2, primask
  mrs r3, basepri
  mrs r4, faultmask
  mrs r5, control
  add.w r6, r6, #1
read_special_exit:
  b .
.thumb_func
write_special:
  msr msp, r0
  msr psp, r1
  msr primask, r2
  msr basepri, r3
  msr basepri_max, r4
  msr faultmask, r5
  msr control, r7
  isb
  add.w r6, r6, #1
write_special_exit:
  b .
.thumb_func
thread_arithmetic:
  adds r0, #1
  adds r1, #2
  add.w r6, r6, #3
thread_arithmetic_exit:
  b .
.thumb_func
interrupt_handler:
  adds r4, #7
  mov.w r5, #0x55
interrupt_return:
  bx lr
