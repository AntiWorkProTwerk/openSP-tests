.syntax unified
.cpu cortex-m7
.thumb
.section .text

/* Original finite privilege controls. CPS instructions are outside IT blocks. */
.global setup_npriv, setup_npriv_exit, observe_disable, observe_disable_exit
.global observe_enable, observe_enable_exit
.balign 32
.thumb_func
setup_npriv:
    movs r0, #1
    msr control, r0
    isb
    adds r2, #1
setup_npriv_exit:
    nop
    b .

.balign 32
.thumb_func
observe_disable:
    cpsid i
    adds r3, #5
    mov.w r4, #0x44
observe_disable_exit:
    nop
    b .

.balign 32
.thumb_func
observe_enable:
    cpsie i
    adds r3, #5
    mov.w r4, #0x44
observe_enable_exit:
    nop
    b .
