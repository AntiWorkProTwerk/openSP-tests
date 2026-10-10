# Feature delivery copy review

The feature page works as a local selection preview. People can choose
features, save or transfer the JSON configuration, and inspect local receipt
metadata against the current choices. The exported file is a plan, not
firmware. The page does not build an image, and its build and USB upload
controls stay disabled.

One line in the composition guide overstated availability: “The current
release offers Synth, global USB screen/control recording and the USB update
path.” The picker has no delivery receipt for a selected combination, and the
global recorder has no complete firmware join or physical recording result. I
changed the opening to describe the local preview, name the global recorder as
planned, and state the current B2 update limit.

The update statement matches the current release status: a modified SP has a
verified DEL/B2 writer, while first installation from untouched stock through
the ordinary USB port remains unverified. The [release status](../../../sp404mk2/RELEASE_STATUS.md)
also requires fresh writer identity, candidate checks, readback, separate
status and reboot confirmation. The [picker page](../../src/pages/features.astro)
states that B2 must already be installed and freshly identified.

I found no other present-availability claim that needs a copy change. The
picker labels the feature area as a preview, shows “Build unavailable,”
disables both delivery controls, and explains that no composed firmware or
matched upload recipe is available. The registry's P6S evidence is a bounded
hardware trial; it says the selectable Synth build and shortcut dispatcher
remain unqualified. It marks the recorder `deliveryReady: false`, scopes its
component to v5.52, and says global physical recording remains unqualified.
The page also says that other firmware needs its own adapter. The shared
[`features.json`](../../src/content/features.json) remains unchanged: its
“still in development” wording describes the requested build and upload work,
and the page makes the current disabled state clear.

This was a source and copy review. No layout, Penpot component, browser session,
device or publication was changed.
