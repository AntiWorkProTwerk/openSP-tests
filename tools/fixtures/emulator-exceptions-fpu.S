.syntax unified
.cpu cortex-m7
.fpu fpv5-d16
.thumb
.text

.global low_high_handler
.type low_high_handler,%function
low_high_handler:
  vmov s0,r0
  vmov s16,r1
  bx lr
  b .

.global conditional_skip
.type conditional_skip,%function
conditional_skip:
  movs r2,#0
  it ne
  vmovne s0,r0
  nop
  b .

.global fp_memory
.type fp_memory,%function
fp_memory:
  vldr s0,[r0]
  vstr s0,[r0,#4]
  vpush {s16-s17}
  vpop {s16-s17}
  vmrs r1,fpscr
  vmsr fpscr,r1
  nop
  b .
