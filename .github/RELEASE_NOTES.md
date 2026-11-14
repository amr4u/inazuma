# v0.1.0 — Mozilla-signed Firefox prototype

This is a **technical prototype**, not a production-ready add-on. These notes
apply only to the new `v0.1.0` signed release created after successful AMO unlisted
signing. The historical `v0.1.0-alpha.1` unsigned release/tag is not changed.

## Assets
- `inazuma-v0.1.0-signed.xpi`: Mozilla-signed, unlisted Firefox MV2 extension; generated only after AMO returns a signed XPI and local signature-marker, identity and exact-payload checks pass.
- `inazuma-v0.1.0-unpacked.zip`: unsigned extension payload for temporary loading/development.
- `inazuma-v0.1.0-source.zip`: matching TypeScript source, build script, lockfile, `.github/AMO_REVIEW.md` and exact tool/environment versions in `BUILD_INFO.json`; also submitted to Mozilla for source review.
- `SHA256SUMS.txt`: SHA-256 digests for all three archives.
- GitHub's automatic source archives refer to the explicit release target commit.

## Firefox testing
1. Verify the downloaded asset against `SHA256SUMS.txt` (`sha256sum -c SHA256SUMS.txt` with all assets in one directory).
2. On Firefox Desktop, open `about:addons` → gear menu → **Install Add-on From File**, then select the signed XPI. Firefox verifies the Mozilla signature during installation.
3. For temporary development loading, extract the unpacked ZIP and select its `manifest.json` at `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**. Temporary add-ons are removed on restart.
4. Open the add-on settings, create a vault password, enter your Cloudflare account ID/API token and create a profile.
5. Open a test form and choose **Smart Fill**. The extension does **not** submit forms automatically.

Firefox Desktop 140+ and Android 142+ are targets, not confirmed real-device
compatibility. Android installation/UI must still be tested separately; an AMO
signature alone does not prove Android functionality.

## Scope and known limitations
- Offline automated tests and self-hosted web-ext lint run before signing.
- Cloudflare Clef-omni live request/response contract and API calls, and end-to-end Firefox behavior, are **not yet verified**.
- Signature markers/payload checks are release integrity guards, not an independent cryptographic certificate-chain verifier. Firefox performs signature verification; signing is not E2E functionality proof.
- No browser-native autofill, server or native helpers.
- Local profile vault is encrypted using a user-defined password.
- Complex custom selects, shadow DOM and iframes are not implemented.

See `README.md` for secret setup/manual release controls and privacy disclosures,
and `.github/AMO_REVIEW.md` for exact reproduction instructions. No credential
values are included in source/release archives.
