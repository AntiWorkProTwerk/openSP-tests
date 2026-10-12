# Safety contract

All stock routes accept only the Roland v5.52 serial identity `0582:02E7` and
must use stable one-shot claim storage. Never target Roland audio/MIDI
`0582:0281`. Keep power and USB stable throughout a carrier or flash operation.

## Primary R51 route

Revision V stages and rereads the exact 18,500-byte R51 writer before mutation.
It sends three 512-byte alignment frames followed by 51 complete 512-byte
carrier packets. Its artifacts are custom OpenSP code, not Roland firmware or
an application image.

R51 accepts only the qualified stock-derived ABI2/B2 image shape and a
caller-supplied SHA-256. It probes the C22016/status40 flash profile, verifies
the full image in RAM, writes only APP1 within its `0x37F000` maximum, programs
the entry sector last, and reads the padded programmed extent back. Separate
terminal reads must agree before the CRC-bound reset arm and commit commands.

The host must durably seal COMMIT-started state through `onBeforeCommit`. That
hook completes before opcode 6 is sent; if it throws, no COMMIT is issued. Once
the hook succeeds, a timeout, close, parse error or page reload is
non-retryable—even when the host did not observe the command result.

## P34 compatibility routes

Revision W, X and Z use a different final trigger: a 16-byte prefix and a
496-byte remainder with a bounded pause. The parser model proves that the prefix
does not begin the copy and that the controlled payload is complete when the
second callback starts at either USB packet size.

Revision W has no FlexSPI base literal or flash-write path. Revision X accepts
only P34 length and CRC, writes APP1 `0x80000..0x333FFF`, programs sector zero
last and compares every 256-byte page. Revision Z accepts only its frozen stock
source, delta and target pins. Do not use their claims, packet sequence or image
policy with Revision V.

## Recovery boundary

Resident firmware, APP0, fuses and status registers are outside the qualified
write paths. The resident SD updater can restore APP1, but it does not prove
recovery from damage outside APP1. After an uncertain mutation, save available
receipts and use only read-only status or boot checks until the recovery state
is understood.
