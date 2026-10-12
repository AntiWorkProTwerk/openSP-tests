# Browser integration

The primary route turns a stock SP-404MKII v5.52 connection into a bounded
installer for a caller-supplied, compatible APP1 image. The package supplies the
pinned R51 writer and Revision V carrier. The host supplies the image, its
SHA-256, durable one-shot storage and the identity expected after reboot.

## Assets and permissions

Copy `assets/stock-r51-v1.osr51` and
`assets/stock-carrier-r51-v1.oscarrier` into the host's public files. Pass their
explicit HTTP paths to `fetchPinnedStockR51VArtifacts`; the function rejects a
changed length or SHA-256. Do not use `new URL()` with an npm export specifier as
if it were a browser URL.

Stock uses Web Serial identity `0582:02E7`. R51 re-enumerates as WebHID
`CAFE:404F`, usage page `FF00`, usage `1`. A fresh browser therefore needs two
permission gestures. The page may keep one main Install control and change its
label to Continue when the second browser permission is required.

## Required flow

1. Obtain the stock serial port from the install action. Fetch the pinned R51
   artifacts and call `bootstrapStockToR51VSerialOnly` with stable claim storage.
   It stages R51, rereads all of it in a new stock session, seals the claim, then
   sends three safe 512-byte alignment frames and 51 full carrier packets once.
2. When R51 appears, reuse an already-authorized HID device or request it from a
   fresh trusted action. Call `attestFreshR51` before any write.
3. Load the caller-supplied APP1, verify its own release metadata, then call
   `installApp1ViaR51`. Its `onBeforeCommit` callback must persist a
   non-retryable COMMIT-started claim. If persistence fails, the library sends
   no COMMIT.
4. After the guarded reset, perform a product-specific, read-only identity check.
   A USB reconnect alone does not prove which firmware booted.

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

const claimKey = 'my-firmware:r51v:claim-v1';
const claims = {
  load: () => localStorage.getItem(claimKey),
  save: (value: string) => localStorage.setItem(claimKey, value),
};

// First trusted action: stock to R51.
const stockPort = await getAuthorizedStockPort(navigator.serial)
  ?? await requestStockPort(navigator.serial);
const artifacts = await fetchPinnedStockR51VArtifacts(
  fetch,
  '/firmware/stock-r51-v1.osr51',
  '/firmware/stock-carrier-r51-v1.oscarrier',
);
const bootstrap = await bootstrapStockToR51VSerialOnly(
  stockPort,
  artifacts,
  claims,
);
saveReceipt(bootstrap);

// Reuse prior permission, or run requestR51Writer from the next trusted action.
const writer = await getAuthorizedR51Writer(navigator.hid)
  ?? await requestR51Writer(navigator.hid);
const attestation = await attestFreshR51(writer, {
  powerCycleConfirmed: false,
  stockCarrierConfirmed: true,
  freshConnectionConfirmed: true,
});
const receipt = await installApp1ViaR51(writer, app1Bytes, {
  expectedSha256: app1Sha256,
  attestation,
  onBeforeCommit: evidence => claims.save(JSON.stringify({
    format: 'my-firmware-r51-claim-v1',
    state: 'app1-commit-started',
    image: evidence,
    retryAllowed: false,
    updatedAt: new Date().toISOString(),
  })),
});
saveReceipt(receipt);
await verifyMyFirmwareReturnedReadOnly();
```

`saveReceipt`, `app1Bytes`, `app1Sha256` and
`verifyMyFirmwareReturnedReadOnly` belong to the host application. Fetch or
prepare the firmware before opening a permission picker when possible; awaiting
unrelated network work inside the click handler can consume transient browser
activation.

## Image contract

`installApp1ViaR51` is generic only within its qualified contract. The current
validator accepts stock-derived ABI2/B2 APP1 images with the fixed retained
bridge envelope and update marker. It copies the bytes, checks the caller's
SHA-256, enforces the image and APP1 bounds, probes the flash profile, verifies
RAM CRC, sends one COMMIT, checks the padded flash extent through separate
terminal reads, then sends the guarded reset pair. It is not a raw arbitrary
flash writer.

Keep released claim keys stable. Treat carrier-started, COMMIT-started,
post-COMMIT errors and reset uncertainty as non-retryable. A recovery UI may
offer read-only status and boot checks, but must not replay the carrier or
COMMIT automatically.

## Compatibility routes

Revision W is a no-flash diagnostic for a staged P34 image. Revision X installs
that exact P34 image directly from stock, and Revision Z reconstructs it from a
specific delta. These routes use a split 16/496-byte final trigger and
P34-specific pins. Their APIs remain exported for existing integrations; R51 V
uses full 512-byte packets and is the primary reusable route.
