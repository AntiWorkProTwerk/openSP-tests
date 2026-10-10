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
    b .

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
    b .

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
    b .

/* Final-slot transfers use ordinary mapped targets, never EXC_RETURN. */
.global final_bx, final_bx_exit, final_bx_target, final_bx_target_exit
.balign 32
.thumb_func
final_bx:
    cmp r0, #0
    it eq
    bxeq r7
    mov.w r6, #0x66
final_bx_exit:
    nop
    b .
.balign 32
.thumb_func
final_bx_target:
    mov.w r6, #0x77
final_bx_target_exit:
    nop
    b .

.global final_pop, final_pop_exit, final_pop_target, final_pop_target_exit
.balign 32
.thumb_func
final_pop:
    cmp r0, #0
    it eq
    popeq {pc}
    mov.w r6, #0x66
final_pop_exit:
    nop
    b .
.balign 32
.thumb_func
final_pop_target:
    mov.w r6, #0x77
final_pop_target_exit:
    nop
    b .
