# v0.1.0-alpha.1 — Firefox development preview

This is an **unsigned development build**, not a production-ready add-on.

## Assets
- `inazuma-v0.1.0-alpha.1-unsigned.xpi`: unsigned Firefox extension package (XPI/ZIP format). **Standard Firefox Desktop and Android will reject installation until it is signed by Mozilla.**
- `inazuma-v0.1.0-alpha.1-unpacked.zip`: extracted Firefox MV2 extension to test with the temporary add-on loader.
- `SHA256SUMS.txt`: file digests.
- GitHub's automatic source-code archives.

## Firefox Desktop test instructions
1. Download `inazuma-v0.1.0-alpha.1-unpacked.zip` and extract it.
2. Navigate to `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on**, then choose the extracted `manifest.json`.
4. Open the add-on settings, create a vault password, enter your Cloudflare account ID and API token, and create a profile.
5. Open a test form and choose **Smart Fill**. The extension does **not** submit forms automatically.

Temporary extensions are removed when Firefox restarts. Standard Firefox Android requires a Mozilla-signed XPI or a separate development/debug workflow.

## Scope and known limitations
- Firefox Desktop / Firefox Android targeted; Android has **not** been tested on a physical device.
- Offline automated tests passed locally; this release workflow re-runs the test suite.
- Cloudflare Clef-omni request/response contract, live API calls, and end-to-end Firefox behavior are **not yet verified**.
- No browser-native autofill, no server, no native helpers.
- The profile vault encrypts local data using a user-defined password.
- Complex custom selects, shadow DOM and iframes are not implemented.

For implementation details, see `README.md` and `docs/ARCHITECTURE.md`.
