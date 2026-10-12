# Publishing the installer package

The package is distributed under the MIT License already authorized for the
owner's OpenSynth contributions. `package.json` declares its SPDX identifier,
and npm includes the package-level `LICENSE` in the archive automatically.

Run the release check from the OpenSP repository:

```powershell
npm run test:usb-installer-package
```

The check rebuilds the package, validates every manifest pin, creates the npm
archive, installs that archive into a clean temporary project, imports the
public API, resolves both bootstrap assets from the installed export map, and
writes `release/SHA256SUMS`. Run it twice and require the same archive digest.

Publish the checked `.tgz`, its `SHA256SUMS`, the selected license, and release
notes that repeat the APP1-only boundary and the no-retry rule for uncertain
carrier or COMMIT results. Do not add an OpenSynth or Roland firmware image to
this transport package.

The final cross-package gate is run from the sibling sp404mk2 repository:

```powershell
python tools\verify_opensynth_release.py
```

This runs the website type check and production build, protocol and browser
tests, both deterministic package builds twice, remote host/UI/client tests and
the cross-package audit. Exit status 0 means the test suite passed, both
archives contain their declared license, every archive and firmware pin
matches, and the physical RC1 input round trip passed. Status 2 means
`analysis/opensynth-release-verification.json` lists unfinished product, owner or
hardware conditions. `--allow-incomplete` is only for recording pre-release test results;
it is not a publish gate.
