# SP-404MKII USB installer

This package contains the browser primitives and pinned bootstrap artifacts used
by OpenSP to install a caller-supplied APP1 image from stock SP-404MKII v5.52.
It contains no Roland firmware and no OpenSynth application image.

The primary route stages and rereads the small R51 writer through stock Web
Serial, starts it with the pinned Revision V carrier, then uses WebHID to upload,
verify and install the caller's image. R51 checks the flash profile and RAM CRC,
writes APP1 with its entry sector last, reads every programmed sector back, and
uses a CRC-bound guarded reset. The host must seal a durable non-retryable claim
through `onBeforeCommit` before R51 receives its only COMMIT command.

```ts
import {
  attestFreshR51,
  bootstrapStockToR51VSerialOnly,
  fetchPinnedStockR51VArtifacts,
  getAuthorizedR51Writer,
  getAuthorizedStockPort,
  installApp1ViaR51,
  requestR51Writer,
  requestStockPort,
} from '@opensp/sp404mk2-usb-installer';
```

The application provides the firmware bytes, their exact SHA-256, stable claim
storage and a product-specific read-only boot check. A fresh browser normally
needs one permission for the stock serial service and another after R51 appears
as a new HID identity. Both pickers must be opened from trusted user actions.

The package also retains the older P34-specific Revision W/X/Z routes as named
compatibility APIs. Their packet geometry and write policy differ from the R51
route; do not mix their carriers, claims or recovery rules.

See [INTEGRATION.md](./INTEGRATION.md) for a complete R51 integration and
[SAFETY.md](./SAFETY.md) for the route-specific boundaries. Copy the required
files from `assets/` to explicit URLs in the host application. Package export
specifiers identify files for build tools and Node; they are not browser URLs.

Build and verify the standalone archive from the OpenSP checkout:

```powershell
npm run package:usb-installer
npm run test:usb-installer-package
```

The build creates `release/opensp-sp404mk2-usb-installer-0.3.0.tgz`. Its
manifest pins every bundled source and artifact, while `release/SHA256SUMS`
pins the archive. The published archive intentionally omits checkout-only build
scripts. Public release still requires the project owner's chosen license; see
[PUBLISHING.md](./PUBLISHING.md).
