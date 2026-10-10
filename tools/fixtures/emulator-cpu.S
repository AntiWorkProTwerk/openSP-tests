.syntax unified
.cpu cortex-m7
.fpu fpv5-d16
.thumb
.text
.global cpu_fp_fixture
.thumb_func
cpu_fp_fixture:
    vmov s0, r0
    vmov s1, r1
    vadd.f32 s2, s0, s1
    vmov r2, s2
    nop
    b .
