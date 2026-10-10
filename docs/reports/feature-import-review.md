# Feature import race review

This review covered the asynchronous configuration import in
`src/scripts/features.ts` and the receipt session's handling of late reads and
checks. The race cases below describe the pre-correction import handler.

The configuration import handler awaited `File.text()` and then applied the
result without checking whether the request was still current. This allowed
three reproducible races:

- Start importing file A, change the profile, feature set, shortcut or reset
  the picker, then let A finish. A replaced the newer choices and persisted
  them.
- Start A and then B. If B finished first and A finished later, A replaced B.
- Start A, then finish B or edit the picker. If A later failed to read or
  parse, its catch handler displayed an error for the superseded request.

The current source has since added an `importRevision` token. Each new import
captures the revision; each selection update advances it. The handler clears
the file input after capturing its `File`, then checks the revision after the
read and again in the error path. Static review confirms that profile, feature,
shortcut and reset changes all call the invalidating update. The source now
ignores the three stale outcomes above.

The root agent reports that the final `npm test` run passed with the optional
local receipt supplied. It returned exit code 0, with 143 feature checks and
195 browser checks passing. The added browser cases passed for all four manual
changes, an older completion and rejection, a newer invalid import, and the
storage-unavailable message. Those results cover the listed import races.

The receipt session already binds each read and inspection to a generation and
canonical selection. Selection changes, clear and cancel advance the generation,
so late results cannot restore a stale receipt. I found no consistency issue
specific to `pagehide`: receipt checks remain in memory, write no storage and
perform no device action. A back-forward-cached page may resume an in-flight
check, but its result still belongs to the unchanged selection; a selection
change invalidates it.

My review was static. The root agent ran the browser suite; it included no
dedicated `pagehide` or back-forward-cache case. The pagehide assessment above
comes from the receipt session's generation checks and its lack of persistent
or device side effects.
