.syntax unified
.cpu cortex-m7
.thumb
.section .text

/* Original register-only conditional-execution fixtures. No firmware input. */
.global single, single_exit, alternate, alternate_exit, four, four_exit
.balign 32
.thumb_func
single:
    cmp r0, #0
    it eq
    moveq.n r1, #0x71
    mov.w r6, #0x66
single_exit:
    nop
    b single_exit

.balign 32
.thumb_func
alternate:
    cmp r0, #0
    ite eq
    addeq.n r1, #3
    subne.n r2, #2
    mov.w r6, #0x66
alternate_exit:
    nop
    b alternate_exit

.balign 32
.thumb_func
four:
    cmp r0, #0
    itttt eq
    addeq.n r1, #1
    subeq.n r2, #2
    moveq.n r3, #0x43
    eoreq.n r4, r5
    mov.w r6, #0x66
four_exit:
    nop
    b four_exit
