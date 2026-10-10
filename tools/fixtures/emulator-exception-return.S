.syntax unified
.cpu cortex-m7
.thumb
.text
.global transfers
transfers:
  bx lr
  bx r4
  pop {r4,pc}
  pop {pc}
  pop.w {r4,r8,pc}
  ldmia r4!,{r5,pc}
  ldmia r0,{r4,pc}
  ldmdb r4!,{r5,pc}
  ldr.w pc,[r4,#8]
  ldr.w pc,[r4,#-8]
  ldr pc,[r4,#8]!
  ldr pc,[r4],#4
  ldr pc,[r4],#-4
  ldr pc,[r4,r5,lsl #2]
  ldr.w pc,[pc,#8]
  ldr.w pc,[pc,#-8]
  pop.w {pc}
  nop
  b .
